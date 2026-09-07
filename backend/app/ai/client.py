import json
from openai import OpenAI
from ..schemas import FieldInput, MappingDecision, ResumeProfile
from .prompts import MAPPING_SYSTEM, RESUME_SYSTEM


class AIClient:
    def __init__(self, api_key: str, model: str, base_url: str):
        # max_retries: the OpenAI SDK retries transient failures (429, 5xx)
        # with exponential backoff before raising.
        self.client = OpenAI(api_key=api_key, base_url=base_url, max_retries=3)
        self.model = model

    def parse_resume(self, text: str) -> ResumeProfile:
        r = self.client.chat.completions.create(
            model=self.model,
            messages=[
                {
                    "role": "system",
                    "content": RESUME_SYSTEM,
                },
                {
                    "role": "user",
                    "content": f"Extract structured resume data from:\n\n{text[:50000]}",
                },
            ],
            response_format={
                "type": "json_schema",
                "json_schema": {
                    "name": "resume_profile",
                    "schema": ResumeProfile.model_json_schema(),
                    "strict": True,
                },
            },
        )

        content = r.choices[0].message.content

        if not content:
            raise ValueError("AI returned an empty response")

        return ResumeProfile.model_validate(json.loads(content))

    def map_fields(
        self, resume: ResumeProfile, fields: list[FieldInput]
    ) -> list[MappingDecision]:
        schema = {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "fieldId": {"type": "string"},
                    "value": {"type": ["string", "boolean", "null"]},
                    "confidence": {"type": "number"},
                    "source": {
                        "type": "string",
                        "enum": ["ai", "heuristic", "manual", "none"],
                    },
                    "reason": {"type": "string"},
                },
                "required": ["fieldId", "value", "confidence", "source", "reason"],
                "additionalProperties": False,
            },
        }
        r = self.client.chat.completions.create(
            model=self.model,
            messages=[
                {
                    "role": "system",
                    "content": MAPPING_SYSTEM,
                },
                {
                    "role": "user",
                    "content": f"Map these resume fields to form fields:\n\nResume: {json.dumps(resume.model_dump())}\n\nFields: {json.dumps([f.model_dump() for f in fields])}",
                },
            ],
            response_format={
                "type": "json_schema",
                "json_schema": {
                    "name": "field_mappings",
                    "schema": schema,
                    "strict": True,
                },
            },
        )
        content = r.choices[0].message.content
        if not content:
            raise ValueError("AI returned an empty response")
        return [MappingDecision.model_validate(x) for x in json.loads(content)]
