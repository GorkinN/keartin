from app.image.qwen_prompt import MASK_NOTE, TRANSPARENT_PREFIX, TRANSPARENT_SUFFIX, build_qwen_prompt, output_resolution


def test_output_resolution_is_the_long_side() -> None:
    assert output_resolution(2752, 1536) == 2752
    assert output_resolution(1024, 1024) == 1024


def test_prompt_wraps_transparency_and_mask() -> None:
    plain = build_qwen_prompt("a fox", transparent=False, has_mask=False)
    assert plain == "a fox"
    wrapped = build_qwen_prompt("a fox", transparent=True, has_mask=True)
    assert wrapped.startswith(TRANSPARENT_PREFIX)
    assert TRANSPARENT_SUFFIX in wrapped
    assert wrapped.endswith(MASK_NOTE)
