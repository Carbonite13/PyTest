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

    # STUN server configuration
    stun_server: str = Field(default="stun:stun.l.google.com:19302")

    # TURN server configuration (optional, for full NAT traversal)
    turn_server: Optional[str] = Field(default=None)
    turn_username: Optional[str] = Field(default=None)
    turn_credential: Optional[str] = Field(default=None)

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
