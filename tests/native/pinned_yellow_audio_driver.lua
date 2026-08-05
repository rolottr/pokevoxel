-- Product-owned Layer 5 native audio gate. This is intentionally the audio
-- subset of pinned Gen1Recomp's audio_runtime_test.lua: it excludes only its
-- unrelated image/battle-animation matte checks, which run before audio.
return function(game)
  local ChipAudio = require("src.core.ChipAudio")
  assert(game.data.audio and game.data.audio.runtime,
    "runtime ROM audio data was not loaded")

  local title = assert(game.data.audio.songs.Music_TitleScreen)
  local pallet = assert(game.data.audio.songs.Music_PalletTown)
  local palletTrace = ChipAudio._traceFirstMusicSampleForTest(game.data, pallet)
  assert(palletTrace[1].register == 1782,
    "Pallet Town B note was not decoded as a tone")

  local insideTrace = ChipAudio._traceFirstSfxSampleForTest(
    game.data, assert(game.data.audio.sfx.Go_Inside))
  assert(insideTrace[1].noiseParameter == 0x44
      and insideTrace[1].volume == 15
      and insideTrace[1].fade == 1,
    "Go Inside did not preserve its first NR42/NR43 register values")

  local collisionTrace = ChipAudio._traceFirstSfxSampleForTest(
    game.data, assert(game.data.audio.sfx.Collision))
  local sweep = assert(collisionTrace[1].sweep,
    "Collision did not preserve its NR10 sweep")
  assert(sweep.pace == 5 and sweep.subtract and sweep.shift == 2,
    "Collision NR10 sweep was decoded incorrectly")

  local music = assert(ChipAudio.playMusic(game.data, title, true))
  -- The pinned threaded synthesizer returns its QueueableSource before the
  -- worker delivers its first buffer. Wait through bounded real frames rather
  -- than asserting the synchronous fallback's state in the same coroutine.
  for _ = 1, 120 do
    ChipAudio.update()
    if music:getFreeBufferCount() < 8 and music:isPlaying() then break end
    coroutine.yield()
  end
  assert(music:getFreeBufferCount() < 8, "title music queued no samples")
  assert(music:isPlaying(), "title music source did not start")

  local sfx = assert(ChipAudio.newSfx(game.data, "Press_AB"))
  assert(sfx:getDuration() > 0.01, "menu sound is empty")
  sfx:play()

  local cry = assert(ChipAudio.newCry(game.data, "PIKACHU"))
  assert(cry:getDuration() > 0.01, "Pikachu cry is empty")
  cry:play()

  local fanfare = assert(ChipAudio.newSfx(game.data, "Level_Up"))
  assert(fanfare:getDuration() > 2.1 and fanfare:getDuration() < 2.3,
    ("Level Up timing is wrong: %.3fs"):format(fanfare:getDuration()))

  if os.getenv("POKEPORT_AUDIO_EXHAUSTIVE") == "1" then
    local sfxCount, cryCount = 0, 0
    for name in pairs(game.data.audio.sfx) do
      assert(ChipAudio.newSfx(game.data, name),
        "could not synthesize SFX " .. name)
      sfxCount = sfxCount + 1
    end
    for species in pairs(game.data.audio.cries) do
      assert(ChipAudio.newCry(game.data, species),
        "could not synthesize cry " .. species)
      cryCount = cryCount + 1
    end
    print(("[audio] exhaustive synthesis: %d SFX, %d cries")
      :format(sfxCount, cryCount))
  end

  print(("[audio] title queued; Press_AB %.3fs; Pikachu %.3fs; Level_Up %.3fs")
    :format(sfx:getDuration(), cry:getDuration(), fanfare:getDuration()))
  ChipAudio.stopMusic()
end
