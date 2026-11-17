Hands-free cooking: MediaPipe hand tracking, served by the app itself.

hand_landmarker.task
  MediaPipe Hand Landmarker, float16, version 1.
  From https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task
  sha256 fbc2a30080c3c557093b5ddfc334698132eb341044ccee322ccf8bcf3607cde1
  Apache License 2.0.

wasm/
  Not checked in. Copied from node_modules/@mediapipe/tasks-vision (0.10.35) by
  scripts/copy-mediapipe.mjs before every dev start and build.

0.10.35 is pinned on purpose: from 1.0 on, the library sends usage logs to
odml.pa.googleapis.com on its own, which would break the promise that nothing
leaves the device. Check any upgrade for that before taking it.
