from pydantic_settings import BaseSettings, SettingsConfigDict
from pydantic import Field
from pydantic import model_validator, model_serializer, field_validator, AfterValidator
from pathlib import Path
from typing import Optional, Literal, Annotated
from functools import lru_cache

type Directory = Annotated[str, AfterValidator(Path.resolve)]

__all__ = ["Settings", "settings"]

class Settings(BaseSettings):

    model_config = SettingsConfigDict(
        env_prefix="",
        env_file="Pot/.env",
        env_file_encoding="utf-8",
        extra="ignore"
    )

    # Centralized audio/ASR configuration.  Audio is relayed as raw PCM to the
    # configured provider; credentials never leave this process.
    deepgram_api_key: Optional[str] = Field(default=None)
    deepgram_api_url: str = Field(default="wss://api.deepgram.com/v1/listen")
    asr_model: str = Field(default="nova-3")
    asr_language: str = Field(default="en-US")
    asr_sample_rate: int = Field(default=16000, ge=8000, le=48000)
    asr_encoding: str = Field(default="linear16")
    downstream_api_url: Optional[str] = Field(default=None)
    downstream_api_key: Optional[str] = Field(default=None)
    downstream_api_timeout_seconds: float = Field(default=5.0, gt=0, le=60)
    forward_interim_transcripts: bool = Field(default=False)
    max_participants_per_room: int = Field(default=4, ge=1, le=32)
    audio_packet_bytes: int = Field(default=640, ge=2, le=65536)
    audio_queue_limit: int = Field(default=64, ge=1, le=512)

    # profile
    profile: Literal["dev", "prod"] = Field(...)

    # Database configurations
    db_hostname: str = Field(...)
    db_port: int = Field(...)
    db_name: str = Field(...)
    db_username: str = Field(...)
    db_password: str = Field(...)
    db_external_url: str = Field(...)

    # App configurations details
    app_info_name: str = Field(...)
    app_info_version: str = Field(...)
    app_info_author: str = Field(...)
    app_info_description: str = Field(...)
    app_contact_email: str = Field(...)
    app_contact_phone: str = Field(...)

    # Directory details
    app_root: str = Field(...)
    log_directory: str = Field(...)
    data_directory: str = Field(...)
    
    # Permissions details
    perm_directory_create: bool = Field(...)

    @field_validator("app_root", "log_directory", "data_directory")
    @classmethod
    def validate_directory(cls, v: str) -> Directory:
        return Path(v).resolve()

# create a global cached instance
@lru_cache
def get_settings() -> Settings:
    return Settings()

settings = get_settings()
