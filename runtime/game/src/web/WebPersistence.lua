-- Product patch over pinned Gen1Recomp SaveData: ordinary browser files are
-- snapshotted only after its tmp/bak/main write succeeds. No ROM/cache paths.
local Events=require("src.web.BrowserEvents"); local Json=require("src.link.Json"); local Serializer=require("src.core.SaveSerializer"); local GameVersion=require("src.core.GameVersion")
local W={saves={}, options=nil, worker=nil, previous=nil}; local ROOT="save-generations/"; local SEQ="save-generation-sequence"; local P={"save-pointer.main","save-pointer.tmp","save-pointer.bak"}; local SCHEMA=1
local function web() return love and love.system and love.system.getOS and love.system.getOS()=="Web" end
local function hash(d) local x=love.data.hash("sha256",d); if type(x)=="userdata" and x.getString then x=x:getString() end; return love.data.encode("string","hex",x) end
local function name(n) return n:match("^[%w_%-]+%.lua$") or n:match("^[%w_%-]+%.lua%.tmp$") or n:match("^[%w_%-]+%.lua%.bak$") end
local function ordinary(p) if p=="options.lua" then return true end; if p:match("^save[_%w%-]*%.lua") then return name(p) end; local _,n=p:match("^saves/([%w_%-]+)/([%w_%-%.]+)$"); return n and name(n) end
local function collect(d,o) for _,n in ipairs(love.filesystem.getDirectoryItems(d) or {}) do local p=d=="" and n or d.."/"..n; local i=love.filesystem.getInfo(p); if i and i.type=="directory" and (p=="saves" or p:match("^saves/[%w_%-]+$")) then collect(p,o) elseif i and i.type=="file" and ordinary(p) then o[#o+1]=p end end end
local function capture() local paths={};collect("",paths);table.sort(paths);local out={};for _,p in ipairs(paths) do out[p]=assert(love.filesystem.read(p)) end;return out end
local function manifest(g) local b=ROOT..g.."/";local mp=b.."manifest.json"; local raw=love.filesystem.getInfo(mp) and love.filesystem.read(mp); local m=raw and Json.decode(raw);if type(m)~="table" or m.schema~=SCHEMA or m.generation~=g or type(m.files)~="table" then return nil end;for _,e in ipairs(m.files) do if not ordinary(e.path or "") then return nil end;local d=love.filesystem.read(b.."files/"..e.path);if not d or hash(d)~=e.sha256 then return nil end end;return m end
local function firstSave(bundle, names)
 for _,path in ipairs(names) do
  local data=bundle[path]
  if data then
   local save=Serializer.decode(data)
   if save then return save end
  end
 end
 return nil
end
local function selectedSave(bundle)
 local version=GameVersion.get()
 local options=Serializer.decode(bundle["options.lua"] or "")
 local slots=options and options.saveSlots and options.saveSlots[version]
 local active=slots and (slots.active or (type(slots.list)=="table" and slots.list[1]))
 if type(active)=="string" and active:match("^[%w_%-]+$") then
  local base="saves/"..version.."/"..active..".lua"
  return firstSave(bundle,{base,base..".tmp",base..".bak"}),version.."-"..active
 end
 local legacy=version=="red" and "save.lua" or "save_"..version..".lua"
 return firstSave(bundle,{legacy,legacy..".tmp",legacy..".bak"}),version.."-default"
end
-- Slot-registry migration is persistence metadata, not a player option. Keep
-- its changing active-slot pointer out of the bounded options proof; the slot
-- itself is reported independently below.
local function optionsHash(optionsBytes)
 local options=Serializer.decode(optionsBytes or "")
 if type(options)~="table" then return hash(optionsBytes or "") end
 local stable={};for key,value in pairs(options) do if key~="saveSlots" then stable[key]=value end end
 return hash(Serializer.encode(stable))
end
local function emitSummary(phase, save, slot, optionsBytes)
 local p=save and save.player or {}; local map=tostring(p.map or "UNKNOWN"):gsub("[^A-Z0-9_]","_"); local party=type(save and save.party)=="table" and math.min(6,#save.party) or 0
 Events.emit("persistence-summary",string.format('{"phase":"%s","version":"%s","slot":"%s","partyCount":%d,"map":"%s","x":%d,"y":%d,"optionsSha256":"%s"}',phase,GameVersion.get(),slot,party,map,math.floor(tonumber(p.x) or 0),math.floor(tonumber(p.y) or 0),optionsHash(optionsBytes)))
end
local function summary(phase, bundle)
 local save,slot=selectedSave(bundle)
 emitSummary(phase,save,slot,bundle["options.lua"])
end
local function snapshot(domain) return {domain=domain,files=capture()} end
function W.request(domain) if not web() then return end;if domain=="save" then W.options=nil;W.saves[#W.saves+1]=snapshot("save") else W.options=snapshot("options") end end
local function nextGen() local seq=love.filesystem.getInfo(SEQ) and love.filesystem.read(SEQ); local max=tonumber(seq or "0") or 0;for _,n in ipairs(love.filesystem.getDirectoryItems(ROOT) or {}) do max=math.max(max,tonumber(n) or 0) end;max=max+1;assert(love.filesystem.write(SEQ,tostring(max)));return tostring(max) end
local function ack(fn,id,domain) local got,ok,err=fn(id,domain);if err then return nil,err end;if got~=id or ok~=id then return nil,"POKEVOXEL_SYNC_STALE_ACK_MISMATCH" end;return true end
local function pointers() local r={};for _,p in ipairs(P) do r[p]=love.filesystem.getInfo(p) and love.filesystem.read(p) end;return r end
local function restorePointers(old) for _,p in ipairs(P) do if old[p] then love.filesystem.write(p,old[p]) elseif love.filesystem.remove then love.filesystem.remove(p) end end end
local function commit(s,dataSync,markerSync)
 local g=nextGen();local b=ROOT..g.."/";if love.filesystem.getInfo(b) then return nil,"POKEVOXEL_GENERATION_EXISTS" end;love.filesystem.createDirectory(b.."files");local m={schema=SCHEMA,generation=g,files={}}
 for p,d in pairs(s.files) do local parent=(b.."files/"..p):match("^(.*)/[^/]+$");if parent then love.filesystem.createDirectory(parent) end;assert(love.filesystem.write(b.."files/"..p,d));m.files[#m.files+1]={path=p,sha256=hash(d)} end
 table.sort(m.files,function(a,b)return a.path<b.path end);assert(love.filesystem.write(b.."manifest.json",Json.encode(m)));if not manifest(g) then return nil,"POKEVOXEL_SAVE_GENERATION_INVALID" end
 local id=Events.requestSync();local ok,code=ack(dataSync,id);if not ok then return nil,code end
 local old=pointers();local ptr=Json.encode({schema=SCHEMA,active=g,previous=W.previous});assert(love.filesystem.write(P[2],ptr));if old[P[1]] then assert(love.filesystem.write(P[3],old[P[1]])) end;assert(love.filesystem.write(P[1],ptr));id=Events.requestPersistence(s.domain);ok,code=ack(markerSync,id,s.domain);if not ok then restorePointers(old);return nil,code end;W.previous=g
 summary("committed",s.files)
 return true
end
function W.hydrate() if not web() then return false end;for _,p in ipairs(P) do local raw=love.filesystem.getInfo(p) and love.filesystem.read(p); local q=raw and Json.decode(raw);if type(q)=="table" then for _,g in ipairs({q.active,q.previous}) do local m=g and manifest(g);if m then local wanted={};for _,e in ipairs(m.files) do wanted[e.path]=true end;local live={};collect("",live);for _,x in ipairs(live) do if not wanted[x] and love.filesystem.remove then love.filesystem.remove(x) end end;for _,e in ipairs(m.files) do local par=e.path:match("^(.*)/[^/]+$");if par then love.filesystem.createDirectory(par) end;love.filesystem.write(e.path,assert(love.filesystem.read(ROOT..g.."/files/"..e.path))) end;local bundle={};for _,e in ipairs(m.files) do bundle[e.path]=assert(love.filesystem.read(ROOT..g.."/files/"..e.path)) end;W.previous=g;summary("restored",bundle);Events.emit("persistence-restored","{}");return true end end end end;return false end
-- This is called only by Game:restoreSave after the title's real Continue
-- path has loaded the selected ordinary save and applied its options.
function W.restoredLive(save)
 if not web() or type(save)~="table" then return end
 local SaveData=require("src.core.SaveData")
 local version=GameVersion.get()
 local active=SaveData.activeSlot(version)
 local slot=active and version.."-"..active or version.."-default"
 emitSummary("resumed",save,slot,Serializer.encode(save.options or {}))
end
function W.update(dataSync,markerSync) if W.worker or (#W.saves==0 and not W.options) then return end;local s=table.remove(W.saves,1) or W.options; if s==W.options then W.options=nil end;W.worker=coroutine.create(function() local ok,c=commit(s,dataSync,markerSync);if not ok and c=="POKEVOXEL_SYNC_ABORTED" then ok,c=commit(s,dataSync,markerSync) end;if not ok then Events.emit("persistence-failed",string.format('{"code":"%s"}',c or "POKEVOXEL_PERSISTENCE_FAILED")) end end) end
function W.resume() if not W.worker then return end;local ok,e=coroutine.resume(W.worker);if not ok then Events.emit("persistence-failed",'{"code":"POKEVOXEL_PERSISTENCE_FAILED"}') end;if coroutine.status(W.worker)=="dead" then W.worker=nil end end
return W
