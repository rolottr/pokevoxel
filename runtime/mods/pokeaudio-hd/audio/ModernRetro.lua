-- PokeAudio HD modern-retro renderer.  The Gen1Recomp interpreter still owns
-- every note, register, envelope, loop, pan command, and cue; this module only
-- reshapes the resulting channel samples and final bus.

local ModernRetro = {}
local Renderer = {}
Renderer.__index = Renderer

local SAMPLE_RATE = 44100
local TAU = math.pi * 2
local SINE_SIZE = 2048
local DUTY_WIDTH = { [0] = 0.125, [1] = 0.25, [2] = 0.5, [3] = 0.75 }
local DUTY_OFFSET = { [0] = 0.125, [1] = 0.125, [2] = 0.375, [3] = -0.125 }
local PAN_LEFT = { 1.00, 0.20, 0.78, 0.38 }
local PAN_RIGHT = { 0.20, 1.00, 0.78, 1.00 }
local SINE = {}
for index = 0, SINE_SIZE - 1 do
  SINE[index + 1] = math.sin(index / SINE_SIZE * TAU)
end

local function clamp(value, low, high)
  return math.max(low, math.min(high, value))
end

local function polyBlep(phase, step)
  if step <= 0 then return 0 end
  if phase < step then
    local t = phase / step
    return t + t - t * t - 1
  end
  if phase > 1 - step then
    local t = (phase - 1) / step
    return t * t + t + t + 1
  end
  return 0
end

local function sine(phase, harmonic)
  local position = (phase * (harmonic or 1)) % 1
  return SINE[math.floor(position * SINE_SIZE) + 1]
end

local function triangle(phase)
  return 1 - 4 * math.abs((phase % 1) - 0.5)
end

local function dcBlock(self, value, side)
  local inputKey = side == 1 and "dcInputL" or "dcInputR"
  local outputKey = side == 1 and "dcOutputL" or "dcOutputR"
  local output = value - self[inputKey] + 0.995 * self[outputKey]
  self[inputKey], self[outputKey] = value, output
  return output
end

local function tone(self, value, side)
  local key = side == 1 and "toneLowL" or "toneLowR"
  local low = self[key] + (value - self[key]) * 0.045
  self[key] = low
  -- Keep the body while taking the brittle edge off the chip oscillators.
  return low * 1.18 + (value - low) * 0.68
end

local function master(value)
  local driven = value * 1.24
  local softened = driven / (1 + 0.32 * math.abs(driven))
  local magnitude = math.abs(softened)
  if magnitude > 0.72 then
    softened = (softened < 0 and -1 or 1)
      * (0.72 + (magnitude - 0.72) * 0.28)
  end
  return clamp(softened, -0.96, 0.96)
end

function ModernRetro.new(config)
  config = config or {}
  return setmetatable({
    amount = clamp(tonumber(config.amount) or 1, 0, 1),
    dcInputL = 0,
    dcOutputL = 0,
    dcInputR = 0,
    dcOutputR = 0,
    toneLowL = 0,
    toneLowR = 0,
    earlyL = {},
    earlyR = {},
    earlyIndex = 1,
    lateL = {},
    lateR = {},
    lateIndex = 1,
  }, Renderer)
end

function Renderer:pulse(stock, phase, frequency, duty, volume, gain, channel)
  local width = DUTY_WIDTH[duty] or DUTY_WIDTH[2]
  local shifted = (phase + (DUTY_OFFSET[duty] or DUTY_OFFSET[2])) % 1
  local step = clamp(frequency / SAMPLE_RATE, 0, 0.25)
  local fundamental = shifted < width and 1 or -1
  fundamental = fundamental + polyBlep(shifted, step)
  fundamental = fundamental - polyBlep((shifted - width) % 1, step)

  -- The ROM still selects pitch, duty and envelope, but HD voices deliberately
  -- move away from a dominant square wave. Channel 1 is a clean lead; channel
  -- 2 is a rounder accompaniment. Both remain phase-locked to the ROM note.
  local hardware = channel and channel.hardware or 1
  local smooth
  if hardware == 2 then
    smooth = triangle(shifted) * 0.56 + sine(shifted) * 0.29
      + sine(shifted, 3) * 0.10 + fundamental * 0.10
  else
    smooth = sine(shifted) * 0.62 + triangle(shifted) * 0.24
      + sine(shifted, 2) * 0.16 + fundamental * 0.08
  end
  local enhanced = smooth * (volume / 15) * gain
  return stock + (enhanced - stock) * self.amount
end

function Renderer:wave(stock, wave, phase, level, gain)
  local position = phase * 32
  local first = math.floor(position) % 32 + 1
  local second = first % 32 + 1
  local fraction = position - math.floor(position)
  local interpolated = wave[first] + (wave[second] - wave[first]) * fraction
  local clean = interpolated * level * gain
  -- Retain enough of the selected ROM wavetable to preserve the instrument,
  -- then give the bass voice a smooth fundamental and controlled octave.
  local enhanced = clean * 0.34
    + sine(phase) * level * gain * 0.58
    + sine(phase, 2) * level * gain * 0.14
  return stock + (enhanced - stock) * self.amount
end

function Renderer:noise(stock, channel, event)
  if channel._pokeaudioNoiseEvent ~= event then
    channel._pokeaudioNoiseEvent = event
    channel._pokeaudioNoisePrevious = stock
    channel._pokeaudioNoiseBody = stock
  end
  local previous = channel._pokeaudioNoisePrevious or stock
  local body = (channel._pokeaudioNoiseBody or stock) * 0.90 + stock * 0.10
  local transient = stock - previous
  local shaped = stock * 0.18 + body * 0.74 + transient * 0.12
  channel._pokeaudioNoisePrevious = stock
  channel._pokeaudioNoiseBody = body
  return stock + (shaped - stock) * self.amount
end

function Renderer:mixChannel(left, right, value, channel, panLeft, panRight)
  if panLeft and panRight then
    local hardware = channel.hardware or 1
    return left + value * (PAN_LEFT[hardware] or 1),
      right + value * (PAN_RIGHT[hardware] or 1)
  end
  if panLeft then left = left + value end
  if panRight then right = right + value end
  return left, right
end

function Renderer:processMono(value)
  local dry = value
  local wet = master(dcBlock(self, tone(self, value, 1), 1))
  return dry + (wet - dry) * self.amount
end

function Renderer:processStereo(left, right)
  local dryLeft, dryRight = left, right
  left = dcBlock(self, tone(self, left, 1), 1)
  right = dcBlock(self, tone(self, right, 2), 2)
  local earlyLeft = self.earlyL[self.earlyIndex] or 0
  local earlyRight = self.earlyR[self.earlyIndex] or 0
  self.earlyL[self.earlyIndex] = left + earlyRight * 0.24
  self.earlyR[self.earlyIndex] = right + earlyLeft * 0.24
  self.earlyIndex = self.earlyIndex % 1493 + 1

  local lateLeft = self.lateL[self.lateIndex] or 0
  local lateRight = self.lateR[self.lateIndex] or 0
  self.lateL[self.lateIndex] = left + lateRight * 0.18
  self.lateR[self.lateIndex] = right + lateLeft * 0.18
  self.lateIndex = self.lateIndex % 3271 + 1

  left = left * 0.84 + earlyLeft * 0.18 + lateRight * 0.10
  right = right * 0.84 + earlyRight * 0.18 + lateLeft * 0.10
  local mid = (left + right) * 0.5
  local side = (left - right) * 0.92
  left, right = master(mid + side), master(mid - side)
  return dryLeft + (left - dryLeft) * self.amount,
    dryRight + (right - dryRight) * self.amount
end

return ModernRetro
