local BrowserEvents = { schemaVersion = 1, prefix = "POKEVOXEL_EVENT ", nextId = 0, requestId = 0, maxBytes = 4096 }
local function escape(value)
  return tostring(value):gsub("\\", "\\\\"):gsub('"', '\\"'):gsub("\n", "\\n"):gsub("\r", "\\r")
end
function BrowserEvents.emit(kind, payload)
  BrowserEvents.nextId = BrowserEvents.nextId + 1
  local frame = love and love.timer and love.timer.getTime and love.timer.getTime() or 0
  local encoded = string.format('{"version":1,"id":%d,"type":"%s","frame":%.6f,"payload":%s}', BrowserEvents.nextId, escape(kind), frame, payload or "{}")
  if #BrowserEvents.prefix + #encoded > BrowserEvents.maxBytes then error("POKEVOXEL_EVENT_TOO_LARGE") end
  print(BrowserEvents.prefix .. encoded)
end
local function nextRequestId()
  BrowserEvents.requestId = BrowserEvents.requestId + 1
  return BrowserEvents.requestId
end
-- Generic cache/import syncs stay on the legacy cache-only protocol.
function BrowserEvents.requestSync()
  local id = nextRequestId()
  BrowserEvents.emit("sync-request", string.format('{"id":%d}', id))
  return id
end
-- Ordinary persistence exposes both its domain and globally unique request id.
-- One sequence prevents an old options acknowledgement from matching a save.
function BrowserEvents.requestPersistence(domain)
  if domain ~= "save" and domain ~= "options" then error("POKEVOXEL_PERSISTENCE_DOMAIN") end
  local id = nextRequestId()
  BrowserEvents.emit("persistence-request", string.format('{"domain":"%s","id":%d}', domain, id))
  return id
end
function BrowserEvents.error(code) BrowserEvents.emit("error", string.format('{"code":"%s"}', escape(code))) end
return BrowserEvents
