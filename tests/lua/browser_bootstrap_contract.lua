-- Fixed ownership probe remains narrow: it can convey no filesystem path or ROM data.
local file = assert(io.open("runtime/game/src/web/BrowserBootstrap.lua", "rb"))
local source = file:read("*a")
file:close()
assert(source:find('FS_OWNER_PROBE = "/tmp/pokevoxel%-fs%-owner%.probe"'))
assert(source:find('token ~= "main" and not token:match%("%^%%d%+%$"%)'))
assert(source:find("Events%.emit%(%\"fs%-owner%\", '{\"owner\":\"main\"}'%)"))
assert(source:find("Events%.emit%(%\"fs%-owner%\", '{\"owner\":' %.%. token %.%. \"}\"%)"))
print("BrowserBootstrap ownership probe contract passed")
