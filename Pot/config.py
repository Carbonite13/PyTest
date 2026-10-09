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
    stun_server: str = Field(default="stun:stun.l.google.com:19302", env="STUN_SERVER")

    # TURN server configuration (optional, for full NAT traversal)
    turn_server: Optional[str] = Field(default=None, env="TURN_SERVER")
    turn_username: Optional[str] = Field(default=None, env="TURN_USERNAME")
    turn_credential: Optional[str] = Field(default=None, env="TURN_CREDENTIAL")

    # profile
    profile: Literal["dev", "prod"] = Field(..., env="PROFILE")

    # Database configurations
    db_hostname: str = Field(..., env="DB_HOSTNAME")
    db_port: int = Field(..., env="DB_PORT")
    db_name: str = Field(..., env="DB_NAME")
    db_username: str = Field(..., env="DB_USERNAME")
    db_password: str = Field(..., env="DB_PASSWORD")
    db_external_url: str = Field(..., env="DB_EXTERNAL_URL")

    # App configurations details
    app_info_name: str = Field(..., env="APP_INFO_NAME")
    app_info_version: str = Field(..., env="APP_INFO_VERSION")
    app_info_author: str = Field(..., env="APP_INFO_AUTHOR")
    app_info_description: str = Field(..., env="APP_INFO_DESCRIPTION")
    app_contact_email: str = Field(..., env="APP_CONTACT_EMAIL")
    app_contact_phone: str = Field(..., env="APP_CONTACT_PHONE")

    # Directory details
    app_root: str = Field(..., env="APP_ROOT")
    log_directory: str = Field(..., env="LOG_DIRECTORY")
    data_directory: str = Field(..., env="DATA_DIRECTORY")
    
    # Permissions details
    perm_directory_create: bool = Field(..., env="PERM_DIRECTORY_CREATE")

    @field_validator("app_root", "log_directory", "data_directory")
    @classmethod
    def validate_directory(cls, v: str) -> Directory:
        return Path(v).resolve()

# create a global cached instance
@lru_cache
def get_settings() -> Settings:
    return Settings()

settings = get_settings()