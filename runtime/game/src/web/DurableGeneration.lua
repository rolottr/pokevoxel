local CacheFs = require("src.import.CacheFs")
local GameVersion = require("src.core.GameVersion")
local DurableGeneration = { previous = nil, restorePrefix = nil }
local REQUIRED = { "data/generated/constants.lua", "data/generated/maps.lua", "data/generated/text.lua", "assets/generated/title/pokemon_logo.png" }
local function write(path, data) if not love.filesystem.write(path, data) then error("POKEVOXEL_POINTER_WRITE") end end
local function pointerWrite(code, path, data) if not love.filesystem.write(path, data) then error("POKEVOXEL_" .. code) end end
local function hash(path)
  local data = CacheFs.read(path)
  if not data then return nil end
  local digest = love.data.hash("sha256", data)
  if type(digest) == "userdata" and digest.getString then digest = digest:getString() end
  return love.data.encode("string", "hex", digest)
end
local function manifestFor()
  local entries = {}
  for _, path in ipairs(REQUIRED) do
    local value = hash(path); if not value then return nil end
    entries[#entries + 1] = string.format('"%s":"%s"', path, value)
  end
  return "{" .. table.concat(entries, ",") .. "}"
end
local function requireAcknowledged(requestId, acknowledged)
  if not requestId or acknowledged ~= requestId then error("POKEVOXEL_SYNC_STALE_ACK_MISMATCH") end
end
local function supportedVersion(version)
  return type(version) == "string" and GameVersion.VERSIONS[version] and version or nil
end
local function generationPrefix(generation, version)
  return "cache-generations/" .. generation .. "/" .. version .. "/"
end
local valid
local function pointerCandidate(raw)
  if type(raw) ~= "string" then return nil end
  local active = raw:match('"active":"([^"]+)"')
  local version = supportedVersion(raw:match('"version":"([^"]+)"')) or "yellow"
  if active and valid(generationPrefix(active, version)) then return active, version end
  local previous = raw:match('"previous":"([^"]+)"')
  local previousVersion = supportedVersion(raw:match('"previousVersion":"([^"]+)"')) or "yellow"
  if previous and valid(generationPrefix(previous, previousVersion)) then return previous, previousVersion end
  return nil
end
valid = function(prefix)
  local old = CacheFs.prefix
  if prefix ~= nil then CacheFs.prefix = prefix end
  local raw = CacheFs.read("hash-manifest.json")
  local ok = raw and CacheFs.exists("rom-cache.complete")
  if ok then
    for path, expected in raw:gmatch('"([^"]+)":"([0-9a-f]+)"') do
      if hash(path) ~= expected then ok = false; break end
    end
  end
  CacheFs.prefix = old
  return ok == true
end
function DurableGeneration.importInto(syncPersistentFs, generation, version, extract)
  version = assert(supportedVersion(version), "POKEVOXEL_VERSION_INVALID")
  if not DurableGeneration.previous then
    for _, path in ipairs({"cache-pointer.main", "cache-pointer.bak"}) do
      if love.filesystem.getInfo(path, "file") then
        local previousGeneration, previousVersion = pointerCandidate(love.filesystem.read(path))
        if previousGeneration then DurableGeneration.previous = { generation = previousGeneration, version = previousVersion }; break end
      end
    end
  end
  local old = CacheFs.prefix
  local prefix = generationPrefix(generation, version)
  CacheFs.prefix = prefix
  DurableGeneration.restorePrefix = old
  -- This function runs inside BrowserBootstrap's coroutine. Do not put the
  -- extraction or sync waits under pcall/xpcall: LuaJIT cannot yield across
  -- those protected C call boundaries.
  extract()
  local hashes = assert(manifestFor())
  assert(CacheFs.write("hash-manifest.json", hashes))
  assert(CacheFs.write("rom-cache.complete", version .. "-cache-v1")) -- last internal witness
  assert(valid())
  local dataRequestId, dataAcknowledged, dataError = syncPersistentFs()
  if dataError then error(dataError) end
  requireAcknowledged(dataRequestId, dataAcknowledged)
  local previous = DurableGeneration.previous
  local pointer = string.format('{"active":"%s","version":"%s","previous":%s,"previousVersion":%s}', generation, version, previous and string.format('"%s"', previous.generation) or "null", previous and string.format('"%s"', previous.version) or "null")
  pointerWrite("POINTER_TMP", "cache-pointer.tmp", pointer)
  local previousPointer = love.filesystem.getInfo("cache-pointer.main", "file") and love.filesystem.read("cache-pointer.main")
  if previousPointer and #previousPointer > 0 then pointerWrite("POINTER_BAK", "cache-pointer.bak", previousPointer) end
  pointerWrite("POINTER_MAIN", "cache-pointer.main", pointer)
  local pointerRequestId, pointerAcknowledged, pointerError = syncPersistentFs()
  if pointerError then error(pointerError) end
  requireAcknowledged(pointerRequestId, pointerAcknowledged)
  DurableGeneration.previous = { generation = generation, version = version }
  CacheFs.prefix = old
  DurableGeneration.restorePrefix = nil
end
function DurableGeneration.abort()
  CacheFs.prefix = DurableGeneration.restorePrefix or ""
  DurableGeneration.restorePrefix = nil
end
function DurableGeneration.activate(active, version)
  local CacheFs = require("src.import.CacheFs")
  version = assert(supportedVersion(version), "POKEVOXEL_VERSION_INVALID")
  GameVersion.set(version)
  CacheFs.prefix = generationPrefix(active, version)
  -- Generated Lua and images are loaded through LÖVE's normal search path;
  -- mount the accepted immutable generation ahead of the bundled source.
  return CacheFs.mountOverlay(generationPrefix(active, version):sub(1, -2))
end
function DurableGeneration.restoreActive()
  for _, path in ipairs({"cache-pointer.main", "cache-pointer.bak"}) do
    local raw = love.filesystem.getInfo(path, "file") and love.filesystem.read(path)
    local generation, version = pointerCandidate(raw)
    if generation then
      DurableGeneration.previous = { generation = generation, version = version }
      return generation, version
    end
  end
  return nil
end
return DurableGeneration
