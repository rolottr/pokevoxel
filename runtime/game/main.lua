local B=require("src.web.BrowserBootstrap")

function love.load(args) B.load(args) end
function love.update(dt) B.update(dt) end
function love.draw() if _G.POKEVOXEL_GAME then _G.POKEVOXEL_GAME:draw() end end
function love.focus(f) if _G.POKEVOXEL_GAME and _G.POKEVOXEL_GAME.focus then _G.POKEVOXEL_GAME:focus(f) end end
function love.visible(v) if _G.POKEVOXEL_GAME and _G.POKEVOXEL_GAME.visible then _G.POKEVOXEL_GAME:visible(v) end end
function love.keypressed(key,...)
 if B.keypressed(key) then return end
 if _G.POKEVOXEL_GAME and _G.POKEVOXEL_GAME.keypressed then _G.POKEVOXEL_GAME:keypressed(key,...) end
end
function love.keyreleased(key,...)
 if _G.POKEVOXEL_GAME and _G.POKEVOXEL_GAME.keyreleased then _G.POKEVOXEL_GAME:keyreleased(key,...) end
end

function love.run()
 if love.load then love.load(love.arg.parseGameArguments(arg),arg) end
 if love.timer then love.timer.step() end
 local dt=0
 return function()
  if love.event then
   love.event.pump()
   for name,a,b,c,d,e,f in love.event.poll() do
    if name=="quit" and (not love.quit or not love.quit()) then return a or 0 end
    local handler=love.handlers[name]
    if handler then handler(a,b,c,d,e,f) end
   end
  end
  if love.timer then dt=love.timer.step() end
  if love.update then love.update(dt) end
  if love.graphics and love.graphics.isActive() then
   love.graphics.origin()
   love.graphics.clear(love.graphics.getBackgroundColor())
   if love.draw then love.draw() end
   love.graphics.present()
  end
  if love.timer and love.timer.sleep then love.timer.sleep(0.001) end
 end
end
