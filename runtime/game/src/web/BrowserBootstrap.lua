local Events=require("src.web.BrowserEvents")
local Session=require("src.import.RomImportSession")
local DurableGeneration=require("src.web.DurableGeneration")
local WebPersistence=require("src.web.WebPersistence")
local Json=require("src.link.Json")
local GameVersion=require("src.core.GameVersion")
local B={state="waiting-import",browserFocused=true,focusSequence=0}; local ROM="/tmp/pokevoxel-rom.gb"
local MANIFESTS={red="import-manifests/rom_manifest.json",blue="import-manifests/rom_manifest_blue.json",yellow="import-manifests/rom_manifest_yellow.json"}
local function sha1(data)
 local digest=love.data.hash("sha1",data)
 if type(digest)=="userdata" and digest.getString then digest=digest:getString() end
 return love.data.encode("string","hex",digest)
end
local function versionPayload(version) return string.format('{"version":"%s"}',version) end
local function emitAudioProbe()
 local probe=require("src.core.ChipAudio").audioProbe()
 local queued=math.max(0,math.min(8,tonumber(probe.queued) or 0))
 local signature=table.concat({probe.scene,queued>0 and "1" or "0",probe.playing and "1" or "0",probe.effectId,probe.lowHp and "1" or "0",probe.musicSources,probe.pcmPeak,probe.pcmNonzero and "1" or "0",probe.musicVolume,probe.sfxVolume,probe.lowHpActivations,probe.victoryActivations},":")
 if signature==B.lastAudioProbe then return end
 B.lastAudioProbe=signature
 Events.emit("audio-probe",string.format('{"scene":"%s","queued":%d,"playing":%s,"effect":"%s","effectId":%d,"lowHp":%s,"musicSources":%d,"pcmPeak":%d,"pcmFrames":%d,"pcmNonzero":%s,"musicVolume":%d,"sfxVolume":%d,"lowHpActivations":%d,"victoryActivations":%d}',probe.scene,queued,probe.playing and "true" or "false",probe.effect,probe.effectId,probe.lowHp and "true" or "false",probe.musicSources,probe.pcmPeak,probe.pcmFrames,probe.pcmNonzero and "true" or "false",probe.musicVolume,probe.sfxVolume,probe.lowHpActivations,probe.victoryActivations))
end

-- Browser-main writes only these fixed mailbox files. Lua polls and consumes
-- them, so a long-running PThread dynCall never needs DOM keyboard delivery.
function B.keypressed(key) end
local function waitForSync(id)
 local ok="/tmp/pokevoxel-sync-"..id..".ok"; local err="/tmp/pokevoxel-sync-"..id..".err"
 local deadline=(love.timer.getTime() or 0)+15
 while true do
  local f=io.open(ok,"rb"); if f then f:close(); os.remove(ok); return id,id end
  f=io.open(err,"rb"); if f then local body=f:read("*a") or ""; f:close(); os.remove(err); return nil,nil,body:find("abort",1,true) and "POKEVOXEL_SYNC_ABORTED" or "POKEVOXEL_SYNC_FAILED" end
  if (love.timer.getTime() or 0)>=deadline then return nil,nil,"POKEVOXEL_SYNC_TIMEOUT" end
  coroutine.yield()
 end
end
local function sync(id)
 return waitForSync(id or Events.requestSync())
end
local function syncPersistence(id, domain)
 return waitForSync(id or Events.requestPersistence(domain))
end
local function clearTree(path)
 local info=love.filesystem.getInfo(path)
 if not info then return end
 if info.type=="directory" then for _, name in ipairs(love.filesystem.getDirectoryItems(path) or {}) do clearTree(path.."/"..name) end end
 love.filesystem.remove(path)
end
local function clearCache()
 -- Fixed maintenance mode: cache only. Ordinary save generations/pointers and
 -- upstream saves/options are deliberately outside this list.
 clearTree("cache-generations")
 for _, path in ipairs({"cache-pointer.tmp","cache-pointer.bak","cache-pointer.main"}) do love.filesystem.remove(path) end
 local id=Events.requestSync(); local got,ack,err=sync(id)
 if err or got~=id or ack~=id then Events.emit("error",'{"code":"POKEVOXEL_CACHE_CLEAR_FAILED"}') else Events.emit("cache-cleared","{}") end
end
local function clearRequested(args)
 for _, value in ipairs(args or {}) do if value=="--pokevoxel-clear-cache" then return true end end
 return false
end
local function prepareCachedGame()
 local active,version=DurableGeneration.restoreActive()
 if not (active and version and DurableGeneration.activate(active,version)) then return false end
 -- Hydrate only after the cache pointer has selected the retained edition;
 -- ordinary saves are owned by that same GameVersion.
 WebPersistence.hydrate()
 local G=require("src.core.Game") -- Resource allocation is safe before love.run starts; keep the loaded game
 -- private and entirely paused until the explicit browser Start gesture.
 G:load({ deferInitialScreen = true })
 -- Title assets use LÖVE graphics constructors. Allocate them at the same
 -- pre-loop boundary, then transition to this exact state only after Start.
 B.preparedGame=G; B.preparedTitle=G:makeTitleState()
 B.state="awaiting-start"; Events.emit("cache-restored",versionPayload(version))
 return true
end
function B.load(args)
 B.ready=true; Events.emit("bootstrap-ready","{}"); Events.emit("runtime-prepared","{}")
 if clearRequested(args) then B.clearWorker=coroutine.create(clearCache); return end
 -- A raw staged ROM belongs to the one-shot import runtime. A fresh runtime
 -- sees no raw ROM and can safely build the cached game before its frame loop.
 local staged=io.open(ROM,"rb"); if staged then staged:close(); return end
 prepareCachedGame()
end
local function beginImport()
 if B.worker then return end
 B.worker=coroutine.create(function()
  Events.emit("import-phase",'{"phase":"signal-consumed"}')
  local f=assert(io.open(ROM,"rb")); local rom=f:read("*a");f:close();os.remove(ROM)
  Events.emit("import-phase",'{"phase":"rom-read"}')
  local version=GameVersion.forSha1(sha1(rom))
  if not version then error("POKEVOXEL_ROM_UNSUPPORTED") end
  GameVersion.set(version)
  local m=assert(Json.decode(assert(love.filesystem.read(MANIFESTS[version]))))
  Events.emit("import-phase",'{"phase":"manifest-parsed"}')
  local generation=tostring(math.floor(love.timer.getTime()*1000))
  DurableGeneration.importInto(sync,generation,version,function()
   Events.emit("import-phase",'{"phase":"session-entered"}')
   local progressTicks,nextProgress=0,0
   Session.new(rom,m,function(p,t)
    local progress=p/t
    if progress>=nextProgress or p==t then
     Events.emit("import-progress",string.format('{"progress":%.6f}',progress))
     nextProgress=math.min(1,nextProgress+0.01)
    end
    progressTicks=progressTicks+1
    if progressTicks%16==0 then coroutine.yield() end
   end):run()
   rom=nil; collectgarbage("collect")
  end)
  assert(DurableGeneration.activate(generation,version))
  B.state="handoff"; Events.emit("cache-committed",versionPayload(version))
 end)
end
local function startGame()
 local G=B.preparedGame
 if not G then return end
 -- returnToTitle allocates real title assets. It runs with no public game
 -- reference so a nested browser frame cannot update a half-transitioned one.
 B.state="starting"; B.preparedGame=nil
 G:returnToTitle(B.preparedTitle); B.preparedTitle=nil
 _G.POKEVOXEL_GAME=G
 if not B.browserFocused and G.focus then G:focus(false) end
 B.state="running"; Events.emit("game-started","{}")
end

local function consumeBrowserFocus()
 while true do
  local nextSequence=B.focusSequence+1
  local path="/tmp/pokevoxel-focus-"..nextSequence
  local file=io.open(path,"rb")
  if not file then return end
  local value=file:read("*a"); file:close(); os.remove(path)
  B.focusSequence=nextSequence
  local focused=value=="1"
  if focused~=B.browserFocused then
   B.browserFocused=focused
   local G=_G.POKEVOXEL_GAME
   if G and G.focus then G:focus(focused) end
  end
 end
end

function B.update(dt)
 if B.state=="waiting-import" and io.open(ROM,"rb") then beginImport() end
 if B.clearWorker and coroutine.status(B.clearWorker)~="dead" then
  local ok=coroutine.resume(B.clearWorker); if not ok then Events.emit("error",'{"code":"POKEVOXEL_CACHE_CLEAR_FAILED"}') end
 end
 if B.worker and coroutine.status(B.worker)~="dead" then
  local ok, err=coroutine.resume(B.worker); if not ok then DurableGeneration.abort(); B.state="error"; local code=tostring(err):match("POKEVOXEL_[A-Z_]+") or "import-failed"; Events.emit("error",string.format('{"code":"%s"}',code)) end
 end
 consumeBrowserFocus()
 if B.state=="awaiting-start" then local start=io.open("/tmp/pokevoxel-start","rb"); if start then start:close(); os.remove("/tmp/pokevoxel-start"); startGame() end end
 WebPersistence.update(sync, syncPersistence); WebPersistence.resume()
 if _G.POKEVOXEL_GAME then
 local G=_G.POKEVOXEL_GAME
 G:update(dt)
  emitAudioProbe()
  for _, state in ipairs(G.stack.states or {}) do
   if not B.titleReady and state.screenId=="TitleState" and state.phase=="loop" then B.titleReady=true; Events.emit("title-ready", "{}") end
  end
  -- Readiness means the live, concrete overworld instance owns the top of
  -- the stack. A loose `isOverworld` scan can observe stale/prototype state
  -- without proving that the browser is accepting overworld input.
  local top=G.stack and G.stack:top()
  local battlePhase="none"; if top and top.kind then local phase=top.phase; if phase=="menu" then battlePhase="menu" elseif phase=="moveSelect" or phase=="mimicSelect" then battlePhase="move" else battlePhase="messages" end end
  if battlePhase~=B.battlePhase then B.battlePhase=battlePhase; Events.emit("battle-input-phase",string.format('{"phase":"%s"}',battlePhase)) end
  local ready=top==G.overworld and not (G.overworld.runner and G.overworld.runner:isRunning()) and #(G.overworld.scriptMoves or {})==0 and not G.overworld.transitioning and not G.overworld.emote
  if ready~=B.inputReady then B.inputReady=ready; Events.emit("overworld-input-ready",string.format('{"ready":%s}',ready and "true" or "false")) end
  if not B.overworldReady and G.save and G.overworld and top==G.overworld and top.isOverworld then
   B.overworldReady=true; Events.emit("overworld-ready",versionPayload(GameVersion.get()))
  end
  local configured=(G:bootConfig().screens or {}).newGame or "OakSpeech"
  for _, state in ipairs(G.stack.states or {}) do
   if B.titleReady and not B.newGameReady and state.screenId==configured then B.newGameReady=true; Events.emit("new-game-started", "{}") end
  end
 end
end
return B
