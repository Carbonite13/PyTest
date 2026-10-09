# Browser client

`Tea/js/modules/webrtcClient.js` implements the existing P2P topology. It
fetches ICE configuration, acquires local tracks, sends nested signaling
messages, queues early ICE candidates, handles offer/answer state, restarts ICE
after temporary media failure, and closes every peer/track on leave.

`Tea/js/modules/transcription.js` defines the ASR boundary and the versioned
text-event envelope. `BrowserSpeechRecognitionAdapter` is intentionally opt-in:
Web Speech implementations vary in whether audio is processed locally or by a
vendor. The application must obtain consent and choose an implementation whose
data flow is acceptable. Until an offline WebAssembly/native engine is supplied
for the target browsers, strict offline ASR remains an environment limitation;
the integration does not upload microphone audio or fake transcript success.

Run syntax checks with:

```bash
node --check Tea/js/main.js
node --check Tea/js/modules/webrtcClient.js
node --check Tea/js/modules/transcription.js
```
