# Audio protocol examples

```json
{"type":"room.join","join":{"room_id":"...","meeting_code":"ABC-123-XYZ","display_name":"Alex","host_token":"..."}}
```

```json
{"type":"audio.frame","participant_id":"server-id","sequence_number":12,"timestamp_ms":240,"sample_rate":16000,"channels":1,"sample_format":"s16le","sample_count":320}
```

The metadata is followed by one binary 640-byte PCM payload. The recipient
must treat the two messages as a pair. Payloads with any other size or sent
before room admission/audio start are rejected or ignored.
