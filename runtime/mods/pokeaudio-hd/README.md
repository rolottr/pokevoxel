# PokeAudio HD

PokeAudio HD is an installable Gen1Recomp audio renderer for Red, Blue, and
Yellow. It keeps the ROM's original compositions, notes, timing, envelopes,
loops, panning commands, cries, and sound-effect ownership. It changes only
the synthesized timbre and final mix.

The renderer replaces the dominant square-wave timbre with separate smooth
lead and accompaniment voices, reinforces the wavetable bass with a clean
fundamental, softens percussion noise, and adds wider stereo placement plus a
short cross-channel room tail. DC blocking, tone control, saturation, and a
bounded limiter keep the result controlled. It contains no soundtrack
recordings or ROM-derived assets.

Install the directory under `mods/pokeaudio-hd`. The audio service always loads
so its live controls are available for the whole session. Press F9 during play
to compare `AUDIO: HD` and `AUDIO: 8BIT` without restarting the source or
changing the current song position; F9 is temporary. For a live setting that
also survives the next launch, press F10, open `PokeAudio HD`, and change the
single `AUDIO DRIVER` row to `HD` or `8BIT`. Pokevoxel's startup checkbox writes
that same saved setting before the title begins.

The current release has one clearly distinct `MODERN RETRO` profile. Its room
tail uses two small fixed circular buffers and no convolution or look-ahead,
so menu cues, battle effects, and browser worker synthesis stay responsive.
