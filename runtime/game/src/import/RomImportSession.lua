local GameVersion = require("src.core.GameVersion")
local RomExtractor = require("src.import.RomExtractor")
local RomImportSession = {}
RomImportSession.__index = RomImportSession
local function sha1(data)
  local digest = love.data.hash("sha1", data)
  if type(digest) == "userdata" and digest.getString then digest = digest:getString() end
  return love.data.encode("string", "hex", digest)
end
function RomImportSession.new(romData, manifest, onProgress)
  return setmetatable({ romData = romData, manifest = manifest, onProgress = onProgress, complete = false }, RomImportSession)
end
function RomImportSession:run()
  if type(self.romData) ~= "string" or #self.romData ~= 1024 * 1024 then error("ROM_WRONG_SIZE") end
  local expected = GameVersion.info().sha1
  if sha1(self.romData) ~= expected then error("ROM_WRONG_DIGEST") end
  if not self.manifest or self.manifest.romSha1 ~= expected then error("ROM_MANIFEST_INVALID") end
  local extractor = RomExtractor.new(self.romData, self.manifest, function(progress, total, stage, current, stageTotal)
    if self.onProgress then
      self.onProgress(progress, total, stage, current, stageTotal)
    else
      coroutine.yield()
    end
  end)
  extractor:run()
  self.romData = nil
  collectgarbage("collect")
  self.complete = true
end
return RomImportSession
