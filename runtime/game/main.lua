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
 local stats={}
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
  local clock=love.timer and love.timer.getTime
  local t0=clock and clock() or 0
  if love.update then love.update(dt) end
  local t1=clock and clock() or t0
  local t2,t3,drawCalls,canvasSwitches=t1,t1,0,0
  if love.graphics and love.graphics.isActive() then
   love.graphics.origin()
   love.graphics.clear(love.graphics.getBackgroundColor())
   if love.draw then love.draw() end
   t2=clock and clock() or t1
   love.graphics.getStats(stats)
   drawCalls=stats.drawcalls or 0; canvasSwitches=stats.canvasswitches or 0
   love.graphics.present()
   t3=clock and clock() or t2
  end
  B.frameSample(dt,(t1-t0)*1000,(t2-t1)*1000,(t3-t2)*1000,drawCalls,canvasSwitches,0)
  -- No sleep: the browser event loop already paces this callback. A 1ms
  -- sleep here pushed tight iterations past their vsync slot.
 end
end
