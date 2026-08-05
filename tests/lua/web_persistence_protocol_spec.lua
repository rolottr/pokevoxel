-- Run with: luajit tests/lua/web_persistence_protocol_spec.lua
-- Mock the LÖVE save FS and prove domain/id acknowledgement boundaries without
-- mounting IDBFS or touching a ROM.
package.path = "runtime/game/?.lua;runtime/game/?/init.lua;" .. package.path

local function fresh()
  package.loaded["src.web.WebPersistence"] = nil
  package.loaded["src.web.BrowserEvents"] = nil
  require("src.core.GameVersion").set("yellow")
  local store = { ["options.lua"] = "options", ["save_yellow.lua"] = "save", ["save_yellow.lua.tmp"] = "upstream-tmp", ["save_yellow.lua.bak"] = "upstream-bak" }
  local directories = { [""] = {} }
  local events = {}
  local function directoryItems(dir)
    local out, seen = {}, {}
    for path in pairs(store) do
      local parent, name = path:match("^(.*)/([^/]+)$")
      if not parent then parent, name = "", path end
      if parent == dir and not seen[name] then seen[name] = true; out[#out + 1] = name end
    end
    for path in pairs(directories) do
      local parent, name = path:match("^(.*)/([^/]+)$")
      if parent == dir and not seen[name] then seen[name] = true; out[#out + 1] = name end
    end
    table.sort(out)
    return out
  end
  love = {
    system = { getOS = function() return "Web" end },
    timer = { getTime = function() return 1 end },
    data = { hash = function(_, data) return data end, encode = function(_, _, data) return data end },
    filesystem = {
      getDirectoryItems = directoryItems,
      getInfo = function(path)
        if directories[path] then return { type = "directory" } end
        if store[path] then return { type = "file" } end
      end,
      read = function(path) if store[path] == nil then error("absent read: " .. path) end; return store[path] end,
      write = function(path, data) store[path] = data; return true end,
      createDirectory = function(path) directories[path] = directories[path] or {}; return true end,
    },
  }
  print = function(line) events[#events + 1] = line end
  return require("src.web.WebPersistence"), events, store
end

local function requestId(events)
  return assert(events[#events]:match('"id":(%d+)')) + 0
end

-- A first browser run has no save pointer yet; hydration must return false
-- without decoding an empty/nonexistent file or delaying the import worker.
do
  local W = fresh()
  assert(W.hydrate() == false)
end

-- Options followed by a save coalesces into exactly one save-domain marker;
-- its ack is the exact id just emitted, after an independent data sync.
do
  local W, events = fresh()
  W.request("options"); W.request("save")
  local dataCalls, markerDomain = 0, nil
  W.update(function()
    dataCalls = dataCalls + 1
    local id = requestId(events)
    return id, id
  end, function(_, domain)
    markerDomain = domain
    local id = requestId(events)
    return id, id
  end)
  W.resume()
  assert(dataCalls == 1 and markerDomain == "save")
  local persistence = 0
  for _, event in ipairs(events) do
    if event:find('"type":"persistence-request"', 1, true) then
      persistence = persistence + 1
      assert(event:find('"domain":"save"', 1, true))
    end
  end
  assert(persistence == 1)
end

-- A mismatched (stale/duplicate) marker acknowledgement fails the generation;
-- it cannot be treated as a save completion.
do
  local W, events = fresh()
  W.request("save")
  W.update(function()
    local id = requestId(events)
    return id, id
  end, function()
    local id = requestId(events)
    return id, id + 1
  end)
  W.resume()
  local failed = false
  for _, event in ipairs(events) do
    if event:find('"type":"persistence-failed"', 1, true)
        and event:find('POKEVOXEL_SYNC_STALE_ACK_MISMATCH', 1, true) then failed = true end
  end
  assert(failed)
end


-- A corrupt active generation restores the previous hash-valid snapshot.  The
-- upstream main/tmp/bak files are ordinary bundle members and stay owned by
-- SaveData: hydration copies them, never rewrites or promotes them.
do
  local W, events, store = fresh()
  local function dataSync() local id = requestId(events); return id, id end
  local function markerSync() local id = requestId(events); return id, id end
  W.request("save"); W.update(dataSync, markerSync); W.resume()
  store["save_yellow.lua"] = "newer-save"
  W.request("save"); W.update(dataSync, markerSync); W.resume()
  -- Generation 1000-2 is active; corrupt its copied main file, leave the
  -- manifest unchanged, and clear the live bundle before startup hydration.
  store["save-generations/2/files/save_yellow.lua"] = "corrupt"
  store["save_yellow.lua"] = nil
  store["save_yellow.lua.tmp"] = nil
  store["save_yellow.lua.bak"] = nil
  assert(W.hydrate())
  assert(store["save_yellow.lua"] == "save")
  assert(store["save_yellow.lua.tmp"] == "upstream-tmp")
  assert(store["save_yellow.lua.bak"] == "upstream-bak")
  assert(events[#events]:find('"type":"persistence-restored"', 1, true))
end

print("Web persistence protocol mock passed")

-- A save snapshot subsumes an older options snapshot; after the save commits
-- no stale options-only generation can run later and become authoritative.
do
  local W, events = fresh()
  W.request("options"); W.request("save")
  local calls = 0
  local function data(id) return id,id end
  local function marker(id) calls=calls+1; return id,id end
  W.update(data, marker); W.resume()
  W.update(data, marker); W.resume()
  assert(calls == 1)
end

-- Data sync failure leaves the existing pointer untouched; marker failure
-- rolls every pointer witness back; AbortError retries exactly once.
do
  local W, events, store = fresh()
  store["save-pointer.main"] = '{"schema":1,"active":"9","previous":null}'
  W.request("save")
  W.update(function(id) return nil,nil,"POKEVOXEL_SYNC_FAILED" end, function(id) return id,id end); W.resume()
  assert(store["save-pointer.main"] == '{"schema":1,"active":"9","previous":null}')
  W.request("save")
  W.update(function(id) return id,id end, function(id) return nil,nil,"POKEVOXEL_SYNC_FAILED" end); W.resume()
  assert(store["save-pointer.main"] == '{"schema":1,"active":"9","previous":null}')
  local attempts = 0
  W.request("save")
  W.update(function(id) attempts=attempts+1; if attempts==1 then return nil,nil,"POKEVOXEL_SYNC_ABORTED" end return id,id end, function(id) return id,id end)
  W.resume()
  assert(attempts == 2)
end

-- Summary payloads are bounded and preserve the same opaque slot/location
-- facts across commit and restore; no save bytes or path are emitted.
do
  local W, events = fresh(); W.request("save")
  local function sync(id) return id,id end
  W.update(sync,sync); W.resume(); assert(W.hydrate())
  local committed,restored
  for _,line in ipairs(events) do
    if line:find('"type":"persistence-summary"',1,true) then
      if line:find('"phase":"committed"',1,true) then committed=line else restored=line end
    end
  end
  assert(committed and restored)
  for _,key in ipairs({'"slot":"yellow-default"','"partyCount":0','"map":"UNKNOWN"','"x":0','"y":0'}) do assert(committed:find(key,1,true) and restored:find(key,1,true)) end
  assert(committed:match('"optionsSha256":"[^"]+"') == restored:match('"optionsSha256":"[^"]+"'))
end
