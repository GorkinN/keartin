from __future__ import annotations

import asyncio

import pytest
from PIL import Image
from pydantic import ValidationError

from app.api.pipeline import ImagePipelineRequest, PostPipelineRequest
from app.pipeline.post_pipeline import (
    INSUFFICIENT_CONTEXT,
    PipelineError,
    PostSpec,
    build_post_messages,
    build_post_user_message,
    clean_image_prompt,
    resolve_job_id,
    retrieve_hits,
    save_png,
    select_hits,
    write_post,
)
from app.rag.qdrant_store import SearchHit


def _spec(**overrides: object) -> PostSpec:
    data: dict[str, object] = {
        "topic": "цена и спрос",
        "tone": "",
        "length": "S",
        "emoji": False,
        "knowledge_mode": "general",
        "citations": False,
        "hooks": True,
        "body": True,
        "cta": True,
        "book_ids": (),
        "top_k": 10,
        "preset_description": "",
        "preset_examples": (),
        "temperature": None,
        "width": 1024,
        "height": 1024,
        "steps": 28,
        "seed": None,
        "job_id": None,
    }
    data.update(overrides)
    return PostSpec(**data)  # type: ignore[arg-type]


def _hit(text: str, *, name: str = "SecretSource", score: float = 0.9) -> SearchHit:
    return SearchHit(
        book_id="book-1",
        chunk_index=0,
        source_name=name,
        lang="ru",
        text=text,
        score=score,
    )


class _Retriever:
    def __init__(self, hits: list[SearchHit] | None = None, *, fail: bool = False) -> None:
        self.hits = hits or []
        self.fail = fail
        self.called = False

    async def search(self, **kwargs: object) -> list[SearchHit]:
        self.called = True
        if self.fail:
            raise AssertionError("search must not run")
        return self.hits


def test_cta_off_is_absent_from_prompt() -> None:
    message = build_post_user_message(_spec(cta=False), [])
    folded = message.casefold()
    assert "призыв" not in folded
    assert "cta" not in folded
    system = build_post_messages(_spec(cta=False), [])[0]["content"].casefold()
    assert "призыв" not in system
    assert "cta" not in system


def test_citations_off_hides_source_name() -> None:
    hit = _hit("фрагмент про спрос", name="КнигаРедкоеИмя")
    hidden = build_post_user_message(_spec(knowledge_mode="rag", citations=False), [hit])
    shown = build_post_user_message(_spec(knowledge_mode="rag", citations=True), [hit])
    assert "КнигаРедкоеИмя" not in hidden
    assert "фрагмент про спрос" in hidden
    assert "КнигаРедкоеИмя" in shown


def test_general_prompt_has_no_context_block() -> None:
    message = build_post_user_message(_spec(knowledge_mode="general"), [])
    assert "Контекст:" not in message
    assert "живой, разговорный" in message
    assert "около 500 символов" in message


def test_rag_plus_without_hits_uses_general_knowledge() -> None:
    message = build_post_user_message(_spec(knowledge_mode="rag_plus"), [])
    assert "Релевантных фрагментов нет" in message
    assert "Контекст:" not in message


def test_select_hits_stops_at_char_budget() -> None:
    hits = [_hit("а" * 3000, score=1 - index / 10) for index in range(5)]
    selected = select_hits(hits, budget=10_000)
    assert len(selected) == 3
    assert sum(len(hit.text) for hit in selected) == 9000


def test_select_hits_truncates_only_first_oversized_chunk() -> None:
    selected = select_hits([_hit("б" * 15_000)], budget=10_000)
    assert len(selected) == 1
    assert len(selected[0].text) == 10_000


def test_rag_without_books_does_not_search() -> None:
    retriever = _Retriever(fail=True)

    with pytest.raises(PipelineError, match=INSUFFICIENT_CONTEXT):
        asyncio.run(retrieve_hits(_spec(knowledge_mode="rag", book_ids=()), retriever))

    assert retriever.called is False


def test_rag_empty_search_errors() -> None:
    retriever = _Retriever([])

    with pytest.raises(PipelineError, match=INSUFFICIENT_CONTEXT):
        asyncio.run(
            retrieve_hits(_spec(knowledge_mode="rag", book_ids=("book-1",)), retriever)
        )


def test_general_does_not_search() -> None:
    retriever = _Retriever(fail=True)
    hits = asyncio.run(retrieve_hits(_spec(knowledge_mode="general"), retriever))
    assert hits == []
    assert retriever.called is False


def test_rag_plus_empty_search_returns_no_hits() -> None:
    retriever = _Retriever([])
    hits = asyncio.run(
        retrieve_hits(_spec(knowledge_mode="rag_plus", book_ids=()), retriever)
    )
    assert hits == []
    assert retriever.called is True


def test_save_png_does_not_change_post(tmp_path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        "app.pipeline.post_pipeline.pipeline_dir",
        lambda job_id: tmp_path / job_id,
    )
    write_post("job-1", "готовый пост")
    before = (tmp_path / "job-1" / "post.txt").read_bytes()
    save_png("job-1", Image.new("RGB", (8, 8), "red"))
    assert (tmp_path / "job-1" / "post.txt").read_bytes() == before
    assert (tmp_path / "job-1" / "image.png").is_file()


def test_clean_image_prompt_strips_fence() -> None:
    raw = '```text\n"a red square in soft light"\n```'
    assert clean_image_prompt(raw) == "a red square in soft light"


def test_resolve_job_id_rejects_path_tricks() -> None:
    assert resolve_job_id("job-1") == "job-1"
    with pytest.raises(PipelineError):
        resolve_job_id("../etc")
    with pytest.raises(PipelineError):
        resolve_job_id("a/b")


def test_request_rejects_bad_image_size_and_job_id() -> None:
    with pytest.raises(ValidationError):
        PostPipelineRequest(topic="тема", width=1000)
    with pytest.raises(ValidationError):
        ImagePipelineRequest(text="пост", job_id="../x")
