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
-- Bounded numeric frame-pacing evidence; every field is clamped so the closed
-- browser-side schema can never reject a live report over a stray extreme.
local function ms(value) local n=tonumber(value) or 0; if n~=n or n<0 then n=0 elseif n>60000 then n=60000 end; return n end
local function count(value, max) local n=tonumber(value) or 0; if n~=n then n=0 end; n=math.floor(n); if n<0 then n=0 elseif n>max then n=max end; return n end
function BrowserEvents.frameProbe(p)
  BrowserEvents.emit("frame-probe", string.format(
    '{"frames":%d,"avgMs":%.3f,"p99Ms":%.3f,"worstMs":%.3f,"avgUpdateMs":%.3f,"avgDrawMs":%.3f,"avgPresentMs":%.3f,"worstUpdateMs":%.3f,"worstDrawMs":%.3f,"worstPresentMs":%.3f,"gcMs":%.3f,"memKb":%d,"drawCalls":%d,"canvasSwitches":%d,"meshJobs":%d,"meshUploads":%d,"meshMs":%.3f,"shadowMs":%.3f,"audioQueued":%d}',
    count(p.frames, 2000), ms(p.avgMs), ms(p.p99Ms), ms(p.worstMs), ms(p.avgUpdateMs), ms(p.avgDrawMs), ms(p.avgPresentMs),
    ms(p.worstUpdateMs), ms(p.worstDrawMs), ms(p.worstPresentMs), ms(p.gcMs), count(p.memKb, 4194304), count(p.drawCalls, 1000000),
    count(p.canvasSwitches, 1000000), count(p.meshJobs, 100000), count(p.meshUploads, 100000), ms(p.meshMs), ms(p.shadowMs), count(p.audioQueued, 32)))
end
return BrowserEvents
