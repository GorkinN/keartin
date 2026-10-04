from __future__ import annotations

import logging

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

from app.topics.rank import RANK_FAILED, TopicRanker, TopicsError

router = APIRouter(prefix="/topics")
logger = logging.getLogger(__name__)


class RankRequest(BaseModel):
    area: str = ""
    headlines: list[str] = Field(default_factory=list)
    outline_items: list[str] = Field(default_factory=list)


class TopicOut(BaseModel):
    title: str
    reason: str


class RankResponse(BaseModel):
    topics: list[TopicOut]


def _ranker(request: Request) -> TopicRanker:
    return request.app.state.topics


@router.post("/rank", response_model=RankResponse)
async def rank_topics(body: RankRequest, request: Request) -> RankResponse:
    try:
        topics = await _ranker(request)(
            area=body.area,
            headlines=body.headlines,
            outline_items=body.outline_items,
        )
    except TopicsError as exc:
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc
    except Exception as exc:
        logger.warning("topic rank failed: %s", exc)
        raise HTTPException(status_code=502, detail=RANK_FAILED) from exc
    return RankResponse(topics=[TopicOut.model_validate(item) for item in topics])
