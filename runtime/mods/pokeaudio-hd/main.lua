return function(mod)
  local ChipAudio = require("src.core.ChipAudio")
  local descriptor = {
    id = "pokeaudio-hd",
    path = mod.path .. "/audio/ModernRetro.lua",
    config = { amount = 1, liveSwitch = true },
  }
  local rendererSchema = {
    {
      key = "renderer",
      type = "choice",
      label = "AUDIO DRIVER",
      choices = {
        { "HD", "pokeaudio-hd" },
        { "8BIT", "stock" },
      },
      default = "pokeaudio-hd",
    },
  }
  if mod.options and mod.options.define then
    mod.options:define(rendererSchema)
  end
  ChipAudio.setLiveRendererSwitch(true)

  local rendererId = "stock"
  local noticeTarget
  local noticeSettled = false
  local noticeFrames = 0

  local function rendererLabel(id)
    return id == "pokeaudio-hd" and "HD" or "8BIT"
  end

  local function normalizedRenderer(value)
    return value == "stock" and "stock" or "pokeaudio-hd"
  end

  local function selectRenderer(id, announce)
    local selected = id == "pokeaudio-hd" and descriptor or nil
    local ok, actual = ChipAudio.setRenderer(selected)
    if not ok then
      error("PokeAudio HD could not select its renderer: "
        .. tostring(actual), 0)
    end
    rendererId = actual or ChipAudio.getRendererId()
    mod.exports.renderer = rendererId
    if announce then
      noticeTarget = rendererId
      noticeSettled = false
      noticeFrames = 0
    end
    return rendererId
  end

  mod.exports.selectedRenderer = function()
    return rendererId
  end
  mod.exports.selectRenderer = function(value, announce)
    return selectRenderer(normalizedRenderer(value), announce == true)
  end
  mod.exports.toggle = function()
    return selectRenderer(rendererId == "pokeaudio-hd" and "stock"
      or "pokeaudio-hd", true)
  end

  if mod.events and mod.events.on then
    mod.events:on("mod.options_changed", function(payload)
      if not (payload and payload.mod == mod.id
          and payload.key == "renderer") then return end
      selectRenderer(normalizedRenderer(payload.value), true)
    end)
  end

  local function drawNotice(next, _, viewport)
    next()
    if not noticeTarget then return end
    local status = ChipAudio.rendererSwitchStatus(noticeTarget)
    local settled = status.current == noticeTarget
    if settled and not noticeSettled then
      noticeSettled = true
      noticeFrames = 90
    elseif settled and noticeFrames <= 0 then
      noticeTarget = nil
      return
    end
    local noticeText
    if settled then
      noticeText = "AUDIO: " .. rendererLabel(noticeTarget)
      noticeFrames = noticeFrames - 1
    else
      noticeText = string.format("AUDIO: %s > %s %.1fs",
        rendererLabel(status.current), rendererLabel(noticeTarget),
        math.max(0.1, status.seconds))
    end
    love.graphics.push("all")
    local width = viewport and viewport.width or love.graphics.getWidth()
    local right = viewport and (viewport.gameX + viewport.gameWidth) or width
    local top = viewport and viewport.gameY or 0
    local font = love.graphics.getFont()
    local padding = 8
    local boxWidth = font:getWidth(noticeText) + padding * 2
    love.graphics.setColor(0, 0, 0, 0.78)
    love.graphics.rectangle("fill", right - boxWidth - 12, top + 12,
      boxWidth, font:getHeight() + padding * 2, 4, 4)
    love.graphics.setColor(1, 0.91, 0.35, 1)
    love.graphics.print(noticeText, right - boxWidth - 12 + padding,
      top + 12 + padding)
    love.graphics.pop()
  end

  if mod.hooks and mod.hooks.wrap then
    mod.hooks:wrap("render.hud", drawNotice)
    mod.hooks:wrap("render.overlay", drawNotice)
  end

  local configured = mod.options and mod.options.get
    and mod.options:get("renderer") or nil
  selectRenderer(normalizedRenderer(configured), false)
end
