from pydantic import ValidationError

from app.api.generate import ImagesGenerateRequest, indexed_seed


def test_indexed_seed_matches_post_batch() -> None:
    assert indexed_seed(42, 0, 1) == 42
    assert indexed_seed(42, 0, 3) == 42
    assert indexed_seed(42, 2, 3) == 44
    assert indexed_seed(2_147_483_647, 1, 2) == 0


def test_images_request_accepts_batch() -> None:
    body = ImagesGenerateRequest(prompt="  a red fox  ", job_id="job-1", count=3, steps=20)
    assert body.prompt == "a red fox"
    assert body.count == 3
    assert body.steps == 20
    assert body.seed is None
    assert body.model == "flux"


def test_images_request_rejects_bad_size_and_count() -> None:
    try:
        ImagesGenerateRequest(prompt="cat", width=1000, height=1024, job_id="abc")
    except ValidationError:
        pass
    else:
        raise AssertionError("width must be a multiple of 16")
    try:
        ImagesGenerateRequest(prompt="cat", job_id="abc", count=21)
    except ValidationError:
        pass
    else:
        raise AssertionError("count must be at most 20")
    try:
        ImagesGenerateRequest(prompt="   ", job_id="abc")
    except ValidationError:
        pass
    else:
        raise AssertionError("blank prompt is rejected")


def test_qwen_request_accepts_native_size_and_rejects_flux_references() -> None:
    body = ImagesGenerateRequest(
        prompt="cat",
        model="qwen",
        width=2048,
        height=2048,
        steps=40,
        job_id="job-qwen",
        reference_paths=["data/tmp/ref.png"],
        transparent=True,
    )
    assert body.model == "qwen"
    assert body.width == 2048
    try:
        ImagesGenerateRequest(prompt="cat", job_id="abc", reference_paths=["data/tmp/ref.png"])
    except ValidationError:
        pass
    else:
        raise AssertionError("flux rejects references")
    try:
        ImagesGenerateRequest(prompt="cat", model="qwen", width=1024, height=1024, steps=60, job_id="abc")
    except ValidationError:
        pass
    else:
        raise AssertionError("qwen steps stop at 50")
