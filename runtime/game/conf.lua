function love.conf(t)
  t.identity = "pokevoxel-yellow"
  t.version = "11.4"
  t.window.title = "Pokevoxel"
  t.window.width = 1024
  t.window.height = 768
  t.window.minwidth = 480
  t.window.minheight = 360
  t.window.resizable = true
  t.window.vsync = 1
  t.modules.physics = false
  t.modules.joystick = true
end
