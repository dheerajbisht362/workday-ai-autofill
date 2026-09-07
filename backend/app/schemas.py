from pydantic import BaseModel, Field
from typing import Optional, Literal


class Basics(BaseModel):
    first_name: Optional[str] = None
    last_name: Optional[str] = None
    full_name: Optional[str] = None
    email: Optional[str] = None
    phone: Optional[str] = None
    location: Optional[str] = None
    linkedin: Optional[str] = None
    github: Optional[str] = None
    website: Optional[str] = None


class Experience(BaseModel):
    company: str
    title: str
    location: Optional[str] = None
    start_date: Optional[str] = None
    end_date: Optional[str] = None
    current: bool = False
    bullets: list[str] = Field(default_factory=list)


class Education(BaseModel):
    institution: str
    degree: Optional[str] = None
    field: Optional[str] = None
    start_date: Optional[str] = None
    end_date: Optional[str] = None


class ResumeProfile(BaseModel):
    basics: Basics
    work_experience: list[Experience] = Field(default_factory=list)
    education: list[Education] = Field(default_factory=list)
    skills: list[str] = Field(default_factory=list)
    certifications: list[str] = Field(default_factory=list)
    # additional_info: Optional[str] = None


class ParseRequest(BaseModel):
    filename: str
    content_base64: str


class FieldInput(BaseModel):
    id: str
    kind: str
    label: str = ""
    description: str = ""
    name: str = ""
    placeholder: str = ""
    ariaLabel: str = ""
    required: bool = False
    options: list[str] = Field(default_factory=list)


class MapRequest(BaseModel):
    resume: ResumeProfile
    fields: list[FieldInput]


class MappingDecision(BaseModel):
    fieldId: str
    value: str | bool | None
    confidence: float = Field(ge=0, le=1)
    source: Literal["ai", "heuristic", "manual", "none"]
    reason: str
