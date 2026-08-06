-- Playback front end for the Game Boy audio synth (src/core/ChipSynth.lua).
--
-- Map/battle MUSIC is streamed from a background worker thread
-- (src/core/chip_worker.lua): the worker synthesizes the PCM buffers and this
-- module only queues finished SoundData onto a QueueableSource.  That is the
-- fix for the map-transition stutter -- filling the deep (~6s) playback queue
-- from scratch when a song changes is ~200ms of Lua synthesis, and doing it on
-- the render thread dropped frames for the ~10 frames after every seam
-- crossing.  Off-thread, a song change costs the main loop essentially
-- nothing.
--
-- When love.thread is unavailable (the headless test stub) or a worker fails
-- to start, music falls back to the original synchronous, amortized queue fill
-- so behavior is unchanged -- see the `threaded` branch in each entry point.
--
-- SFX and cries stay synchronous: they are short one-shots rendered once into
-- a static Source, not a per-frame streaming cost.

local Assets = require("src.render.Assets")
local ChipSynth = require("src.core.ChipSynth")

local ChipAudio = {}

local SAMPLE_RATE = ChipSynth.SAMPLE_RATE
local MUSIC_BUFFER_SAMPLES = ChipSynth.MUSIC_BUFFER_SAMPLES
local MUSIC_BUFFER_COUNT = ChipSynth.MUSIC_BUFFER_COUNT

-- ---------------------------------------------------------------------------
-- Per-channel mix (edit these)
-- Applied on load and whenever this file hot-reloads.
-- Runtime: ChipAudio.setChannelVolume / setChannelPitch.
--   [1] pulse 1   [2] pulse 2   [3] wave   [4] noise / drums
-- Volume: 1 = authentic, 0 = mute, >1 boosts
-- Pitch:  1 = authentic, 2 = +1 octave, 0.5 = -1 octave
-- The shipped values stay at 1: 0.25 / 0.5 on the wave channel buried the Ch3
-- countermelodies an octave low (#429), and ChipSynth already applies the
-- wave channel's own hardware octave (frequency * 0.5).
-- ---------------------------------------------------------------------------
local CHANNEL_VOLUME = {
  [1] = 1, -- pulse 1
  [2] = 1, -- pulse 2
  [3] = 1, -- wave
  [4] = 1, -- noise / drums
}
local CHANNEL_PITCH = {
  [1] = 1, -- pulse 1
  [2] = 1, -- pulse 2
  [3] = 1, -- wave
  [4] = 1, -- noise / drums
}
ChipSynth.setChannelVolumes(CHANNEL_VOLUME)
ChipSynth.setChannelPitches(CHANNEL_PITCH)

-- currentMusic: { source, gen, threaded, started, finished, engine }
--   threaded songs stream from the worker (engine is nil here);
--   the fallback path owns a local engine and fills the source itself.
local currentMusic
-- Browser telemetry is deliberately semantic: it never carries a song label,
-- source path, ROM byte, or PCM sample.  BrowserBootstrap polls this actual
-- queue/source state and publishes a bounded event for the E2E audio gate.
local telemetry = { scene = "none", renderer = "stock", effect = "none", effectId = 0, lowHp = false, pcmPeak = 0, pcmFrames = 0, pcmNonzero = false, lowHpActivations = 0, victoryActivations = 0 }
local pendingBuf -- a current-gen buffer popped from the worker but not yet
                 -- queued because the Source was momentarily full
local liveRendererSwitch = false
local LIVE_SWITCH_QUEUE_TARGET = 2

local function queueTarget()
  return liveRendererSwitch and LIVE_SWITCH_QUEUE_TARGET or MUSIC_BUFFER_COUNT
end

-- QueueableSource exposes how many buffers are still owned by playback. Keep
-- renderer ids in the same order so telemetry changes only when the first
-- buffer that can actually be heard changes, never when a future worker buffer
-- merely arrives. Stock-only boots retain the deep stall-tolerance queue.
local function syncAudibleRenderer(music, queued)
  if not music then return end
  local renderers = music.queuedRenderers or {}
  music.queuedRenderers = renderers
  while #renderers > queued do table.remove(renderers, 1) end
  local audible = renderers[1]
  if audible == "stock" or audible == "pokeaudio-hd" then
    telemetry.renderer = audible
  end
end

local function noteQueuedRenderer(music, renderer)
  if not music then return end
  renderer = renderer == "pokeaudio-hd" and renderer or "stock"
  music.queuedRenderers[#music.queuedRenderers + 1] = renderer
  syncAudibleRenderer(music, #music.queuedRenderers)
end

-- Music holds playback while a fanfare owns the music channels (#398).
-- Pausing the Source is not enough on its own: this module is what starts a
-- chip song (immediately on the sync path, on the first worker buffer on the
-- threaded one), so a song that begins during a jingle would come up
-- underneath it.  Music.duckForFanfare sets the hold, Music releases it when
-- the jingle ends.
local musicHeld = false

-- ---------------------------------------------------------------------------
-- worker management
-- ---------------------------------------------------------------------------

local worker, cmdCh, outCh
local workerReady -- nil = untried, true = running, false = unavailable

-- Install a serializable sample renderer for both the main-thread effect path
-- and the worker music path.  Validation happens before the active renderer
-- changes, so a malformed mod leaves the current stock/working renderer live.
function ChipAudio.setRenderer(descriptor)
  if descriptor and descriptor.config
      and descriptor.config.liveSwitch == true then
    liveRendererSwitch = true
  end
  local ok, err = ChipSynth.setRenderer(descriptor)
  if not ok then return false, err end
  if currentMusic and currentMusic.engine
      and currentMusic.engine.refreshRenderer then
    currentMusic.engine:refreshRenderer()
  end
  if workerReady and cmdCh then
    cmdCh:push({ cmd = "renderer",
      renderer = ChipSynth.getRendererDescriptor(),
      liveSwitch = liveRendererSwitch })
  end
  return true, ChipSynth.getRendererId()
end

function ChipAudio.getRendererId()
  return ChipSynth.getRendererId()
end

local function ensureWorker()
  if workerReady ~= nil then return workerReady end
  if not (love.thread and love.thread.newThread and love.audio) then
    workerReady = false
    return false
  end
  local ok, thread = pcall(love.thread.newThread, "src/core/chip_worker.lua")
  if not ok or not thread then
    workerReady = false
    return false
  end
  cmdCh = love.thread.getChannel("chipaudio_cmd")
  outCh = love.thread.getChannel("chipaudio_out")
  local started = pcall(function() thread:start() end)
  if not started then
    workerReady = false
    return false
  end
  worker = thread
  workerReady = true
  return true
end

-- only the tables ChipSynth.newEngine reads for ROM songs; sent with every
-- play so a hot-reloaded dataset (or a mod's audio) always reaches the worker
local function slimAudio(data)
  local audio = data.audio or {}
  -- NX-only: resolve the versioned cache prefix on the main thread and hand
  -- it to the worker, which runs in a fresh Lua state without GameVersion.
  local programPrefix
  if require("src.core.Platform").isNX() then
    local prefix = require("src.core.GameVersion").cachePrefix()
    if prefix ~= "" then programPrefix = prefix end
  end
  return {
    programFile = audio.programFile,
    programPrefix = programPrefix,
    bankOrder = audio.bankOrder,
    waveBanks = audio.waveBanks,
    noiseHeaders = audio.noiseHeaders,
  }
end

-- If the worker died (a malformed def that errors mid-synth), fall back to the
-- synchronous path for the rest of the session instead of going silent.
local function workerAlive()
  if not worker then return false end
  local err = worker:getError()
  if err then
    require("src.core.Logger").warn("chip audio worker died: %s", tostring(err))
    workerReady = false
    worker = nil
    return false
  end
  return true
end

-- ---------------------------------------------------------------------------
-- synchronous fallback (no love.thread): the original amortized queue fill
-- ---------------------------------------------------------------------------

-- The queue is deep (MUSIC_BUFFER_COUNT, ~6s) for stall tolerance, but
-- synthesizing all of it on the frame a song starts renders ~6s of audio at
-- once.  Cap how many buffers each fill renders; playback drains ~1 buffer
-- every ~11 frames while update() tops up a few per frame, so the deep queue
-- still ramps to full within a fraction of a second.
local MUSIC_FILL_INITIAL = 4
local MUSIC_FILL_PER_CALL = 3

local function recordPcm(pcm)
  if not pcm then return end
  telemetry.pcmPeak = math.max(0, math.min(1000000, tonumber(pcm.peak) or 0))
  telemetry.pcmFrames = math.max(0, math.min(65536, tonumber(pcm.frames) or 0))
  telemetry.pcmNonzero = pcm.nonzero == true
end

local function fillSync(limit)
  local music = currentMusic
  if not music or not music.engine or music.engine:finished() then return end
  limit = limit or MUSIC_FILL_PER_CALL
  local free = music.source:getFreeBufferCount()
  local queued = MUSIC_BUFFER_COUNT - free
  syncAudibleRenderer(music, queued)
  local target = queueTarget()
  while free > 0 and queued < target and limit > 0
      and not music.engine:finished() do
    local sd, pcm = ChipSynth.soundData(music.engine, MUSIC_BUFFER_SAMPLES, 2)
    local renderer = music.engine:getRendererId()
    recordPcm(pcm)
    music.source:queue(sd)
    noteQueuedRenderer(music, renderer)
    free = free - 1
    queued = queued + 1
    limit = limit - 1
  end
end

local function playMusicSync(data, header, allowLoops)
  -- build before tearing down: a def that fails to compile must leave the
  -- outgoing song sounding
  local ok, engine = pcall(ChipSynth.newEngine, data, header,
                           { allowLoops = allowLoops })
  if not ok then return nil, engine end
  local ok2, source = pcall(
    love.audio.newQueueableSource, SAMPLE_RATE, 16, 2, MUSIC_BUFFER_COUNT)
  if not ok2 then return nil, source end
  ChipAudio.stopMusic()
  currentMusic = { source = source, engine = engine, threaded = false,
                   started = true, finished = false, queuedRenderers = {} }
  fillSync(MUSIC_FILL_INITIAL)
  if not musicHeld then source:play() end
  return source
end

-- ---------------------------------------------------------------------------
-- threaded music
-- ---------------------------------------------------------------------------

local musicGen = 0

function ChipAudio.playMusic(data, header, allowLoops)
  if not ensureWorker() then
    return playMusicSync(data, header, allowLoops)
  end
  -- validate the def on this thread (cheap: engine construction, no synthesis)
  -- so a broken def costs nothing but a log line and keeps the old song
  local ok, engine = pcall(ChipSynth.newEngine, data, header,
                           { allowLoops = allowLoops })
  if not ok then return nil, engine end
  -- build the new source before tearing the old song down
  local ok2, source = pcall(
    love.audio.newQueueableSource, SAMPLE_RATE, 16, 2, MUSIC_BUFFER_COUNT)
  if not ok2 then return nil, source end
  ChipAudio.stopMusic()
  musicGen = musicGen + 1
  local gen = musicGen
  cmdCh:push({ cmd = "play", gen = gen, header = header,
               allowLoops = allowLoops, audio = slimAudio(data),
               renderer = ChipSynth.getRendererDescriptor(),
               liveSwitch = liveRendererSwitch,
               channelVolumes = ChipSynth.getChannelVolumes(),
               channelPitches = ChipSynth.getChannelPitches() })
  currentMusic = { source = source, gen = gen, threaded = true,
                   started = false, finished = false,
                   queuedRenderers = {} }
  -- playback starts in update() once the first buffer arrives (~1 frame)
  return source
end

local function pushChannelMix()
  if workerReady and cmdCh then
    cmdCh:push({ cmd = "channelMix",
                 volumes = ChipSynth.getChannelVolumes(),
                 pitches = ChipSynth.getChannelPitches() })
  end
end

-- move finished buffers from the worker into the Source; start playback once
-- the first one lands
local function updateThreaded()
  local m = currentMusic
  if not m then return end
  if not workerAlive() then
    -- worker gone: nothing more will arrive; leave whatever is queued playing
    return
  end
  while true do
    local free = m.source:getFreeBufferCount()
    local queued = MUSIC_BUFFER_COUNT - free
    syncAudibleRenderer(m, queued)
    if queued >= queueTarget() then break end
    local buf = pendingBuf
    if buf then pendingBuf = nil else buf = outCh:pop() end
    if not buf then break end
    if buf.gen ~= m.gen then
      -- stale buffer from a superseded song: drop it
    elseif buf.done then
      m.finished = true
    elseif buf.error then
      require("src.core.Logger").warn("chip audio: %s", tostring(buf.error))
      m.finished = true
    elseif buf.warning then
      require("src.core.Logger").warn("chip audio: %s", tostring(buf.warning))
    elseif buf.sd then
      if free > 0 then
        recordPcm(buf.pcm)
        m.source:queue(buf.sd)
        noteQueuedRenderer(m, buf.renderer)
      else
        pendingBuf = buf -- Source full; hold this one for next frame
        break
      end
    end
  end
  if not m.started and not musicHeld then
    if (MUSIC_BUFFER_COUNT - m.source:getFreeBufferCount()) > 0 then
      pcall(function() m.source:play() end)
      m.started = true
    end
  end
end

function ChipAudio.update()
  local m = currentMusic
  if not m then return end
  if m.threaded then
    updateThreaded()
  else
    fillSync()
  end
end

-- Recover from a queue underrun caused by a long render stall.  Called after
-- Music has handled intentional fanfare pauses, so it never fights the normal
-- pause/resume behavior.
function ChipAudio.ensureMusicPlaying()
  local m = currentMusic
  if not m or m.finished or musicHeld then return end
  if m.threaded then
    if not m.started then return end
    local ok, playing = pcall(function() return m.source:isPlaying() end)
    if ok and not playing
       and (MUSIC_BUFFER_COUNT - m.source:getFreeBufferCount()) > 0 then
      pcall(function() m.source:play() end)
    end
  else
    if not m.engine or m.engine:finished() then return end
    local ok, playing = pcall(m.source.isPlaying, m.source)
    if ok and not playing then
      fillSync(MUSIC_FILL_INITIAL)
      pcall(m.source.play, m.source)
    end
  end
end

-- Silence the song for the length of a fanfare and start whatever was held
-- back once it ends.  Held state outlives a song change: Music.play may swap
-- songs while the jingle is still sounding.
function ChipAudio.holdMusic(held)
  held = not not held
  if held == musicHeld then return end
  musicHeld = held
  if held then return end
  ChipAudio.update()
  ChipAudio.ensureMusicPlaying()
end

-- Threaded playMusic returns an empty QueueableSource and only calls
-- Source:play once the first worker buffer lands (~1 frame later).  Until
-- then Source:isPlaying is false -- callers that treat that as "song over"
-- (Music.oneShotPlaying / pendingRestore) must wait here instead, or a
-- playOnce jingle like Music_PkmnHealed is cut off before it starts.
function ChipAudio.awaitingFirstBuffer()
  local m = currentMusic
  if not (m and m.threaded and not m.started and not m.finished) then
    return false
  end
  -- a dead worker will never deliver the first buffer
  if workerReady == false then return false end
  if worker and worker.getError and worker:getError() then return false end
  return true
end

function ChipAudio.audioProbe()
  local queued, playing = 0, false
  local m = currentMusic
  if m and m.source then
    local ok, free = pcall(m.source.getFreeBufferCount, m.source)
    if ok and type(free) == "number" then
      queued = math.max(0, math.min(MUSIC_BUFFER_COUNT, MUSIC_BUFFER_COUNT - free))
      syncAudibleRenderer(m, queued)
    end
    local isPlaying, value = pcall(m.source.isPlaying, m.source)
    playing = isPlaying and value == true or false
  end
  return { scene = telemetry.scene, renderer = telemetry.renderer,
           queued = queued, playing = playing,
           effect = telemetry.effect, effectId = telemetry.effectId,
           lowHp = telemetry.lowHp, musicSources = m and 1 or 0,
           pcmPeak = telemetry.pcmPeak, pcmFrames = telemetry.pcmFrames,
           pcmNonzero = telemetry.pcmNonzero,
           musicVolume = require("src.core.Music").getVolumeLevel(),
           sfxVolume = require("src.core.Sound").getVolumeLevel(), lowHpActivations = telemetry.lowHpActivations, victoryActivations = telemetry.victoryActivations }
end

-- Call only after a concrete source has been selected.  These labels are a
-- fixed public vocabulary, not game content identifiers.
function ChipAudio.setScene(scene)
  if scene == "none" or scene == "title" or scene == "overworld" or scene == "battle" or scene == "victory" then
    if scene == "victory" and telemetry.scene ~= "victory" then telemetry.victoryActivations = telemetry.victoryActivations + 1 end
    telemetry.scene = scene
  end
end
function ChipAudio.noteEffect(kind)
  if kind ~= "sfx" and kind ~= "low-hp" then return end
  telemetry.effect, telemetry.effectId = kind, telemetry.effectId + 1
end
function ChipAudio.setLowHp(active)
  active = active == true
  if active and not telemetry.lowHp then telemetry.lowHpActivations = telemetry.lowHpActivations + 1; ChipAudio.noteEffect("low-hp") end
  telemetry.lowHp = active
end

function ChipAudio.stopMusic()
  if currentMusic and currentMusic.source then
    pcall(currentMusic.source.stop, currentMusic.source)
  end
  if workerReady and cmdCh then
    cmdCh:push({ cmd = "stop" })
    if outCh then outCh:clear() end
  end
  pendingBuf = nil
  currentMusic = nil
  ChipAudio.setScene("none")
end

-- hot reload: the next play re-reads programs.bin (a mod may have swapped the
-- file out from under the single-slot bank cache), on both threads
function ChipAudio.invalidate()
  ChipAudio.stopMusic()
  ChipSynth.invalidateBanks()
  if workerReady and cmdCh then cmdCh:push({ cmd = "invalidate" }) end
end

-- End the worker thread.  LOVE waits for every live love.thread before the
-- process exits and the worker's command loop only returns on "quit", so
-- skipping this leaves the process running after the window is gone (#339).
function ChipAudio.shutdown()
  ChipAudio.stopMusic()
  if workerReady and cmdCh then cmdCh:push({ cmd = "quit" }) end
  if worker then pcall(function() worker:wait() end) end
  worker, cmdCh, outCh = nil, nil, nil
  workerReady = false
end

-- Runtime mix for one hardware channel (1..4).  Takes effect on the next
-- synthesized buffer (live music) and on any SFX/cry rendered after the call.
function ChipAudio.setChannelVolume(hw, scale)
  ChipSynth.setChannelVolume(hw, scale)
  pushChannelMix()
end

function ChipAudio.getChannelVolume(hw)
  return ChipSynth.getChannelVolume(hw)
end

function ChipAudio.setChannelVolumes(volumes)
  ChipSynth.setChannelVolumes(volumes)
  pushChannelMix()
end

function ChipAudio.getChannelVolumes()
  return ChipSynth.getChannelVolumes()
end

function ChipAudio.setChannelPitch(hw, scale)
  ChipSynth.setChannelPitch(hw, scale)
  pushChannelMix()
end

function ChipAudio.getChannelPitch(hw)
  return ChipSynth.getChannelPitch(hw)
end

function ChipAudio.setChannelPitches(pitches)
  ChipSynth.setChannelPitches(pitches)
  pushChannelMix()
end

function ChipAudio.getChannelPitches()
  return ChipSynth.getChannelPitches()
end

-- aliases for channel 4 (noise / drums)
function ChipAudio.setNoiseVolume(scale)
  ChipAudio.setChannelVolume(4, scale)
end

function ChipAudio.getNoiseVolume()
  return ChipAudio.getChannelVolume(4)
end

-- a stale song must not keep sounding past the flush that replaced its
-- program (20 §2 cache contract, chip music row)
Assets.register(ChipAudio.invalidate)

-- ---------------------------------------------------------------------------
-- one-shot effects (SFX, cries, low-health alarm): synchronous static Sources
-- ---------------------------------------------------------------------------

local function renderEffect(data, header, options)
  local sd, pcm = ChipSynth.renderEffectData(data, header, options)
  if not sd then return nil end
  recordPcm(pcm)
  return love.audio.newSource(sd, "static")
end

function ChipAudio.newSfx(data, name, pitch, tempo, header)
  header = header or data.audio.sfx[name]
  return renderEffect(data, header, {
    frequencyOffset = pitch or 0,
    frameTicks = 0x80 + (tempo or 0x80),
  })
end

-- `resolved` is a {header|chip, pitch, length} def the caller already worked
-- out -- a derived cry borrowing another species' header with its own
-- modifiers, which no registry lookup under `species` could find
function ChipAudio.newCry(data, species, resolved)
  local cry = resolved or (data.audio.cries and data.audio.cries[species])
  if not cry then return nil end
  return renderEffect(data, cry.chip and cry or cry.header, {
    frequencyOffset = cry.pitch,
    cryLength = cry.length,
  })
end

-- Two channels for the same reason ChipSynth.renderEffectData renders stereo:
-- a mono Source is spatialized by OpenAL at the listener position and spreads
-- over every output an interface has (#626).  The siren itself is unchanged,
-- both channels carry the same sample.
function ChipAudio.newLowHealthAlarm()
  local samples = math.floor(SAMPLE_RATE * 62 / 60)
  local data = love.sound.newSoundData(samples, SAMPLE_RATE, 16, 2)
  local phase = 0
  for index = 0, samples - 1 do
    local frame = math.floor(index * 60 / SAMPLE_RATE) % 31
    local register = frame < 11 and 0x750 or 0x6EE
    local frequency = 131072 / (2048 - register)
    phase = (phase + frequency / SAMPLE_RATE) % 1
    local value = (phase < 0.5 and 1 or -1) * 0.25
    data:setSample(index, 1, value)
    data:setSample(index, 2, value)
  end
  return love.audio.newSource(data, "static")
end

return ChipAudio
