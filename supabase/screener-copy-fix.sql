-- Screener copy fix: Languages loses "Other" and "None of the above" (and
-- with them the exclusive-selection rule); "(Select all that apply)" moves
-- out of the question text — the runner renders it as a separate hint line
-- for every multi-select. Only the "screener" key is replaced; all other
-- config flags are preserved.

update public.tests
set config = coalesce(config, '{}'::jsonb) || '{
  "screener": [
    {
      "id": "device",
      "label": "What device are you using right now?",
      "options": ["Desktop or laptop computer", "Tablet", "Smartphone", "Other"],
      "pass_if_any": ["Desktop or laptop computer"],
      "strict_flag": "STRICT_DEVICE",
      "fail_tag": "mobile",
      "disqualify_message": "This study requires a desktop or laptop. Please come back on a computer!"
    },
    {
      "id": "languages",
      "label": "Which of these languages do you speak comfortably?",
      "multi": true,
      "min": 1,
      "options": ["English", "Tibetan", "Chinese", "Spanish"],
      "pass_if_any": ["English"],
      "strict_flag": "STRICT_LANGUAGE",
      "fail_tag": "no_english",
      "disqualify_message": "This study requires comfortable English. Thanks for your interest!"
    },
    {
      "id": "age_range",
      "label": "Which age group are you in?",
      "options": ["18–24", "25–34", "35–44", "45–54", "55–64", "65 or older", "Prefer not to say"]
    },
    {
      "id": "familiarity",
      "label": "How familiar are you with Garchen Rinpoche''s teachings?",
      "options": ["I''ve never heard of them", "Somewhat familiar — I''ve seen or heard a few", "I follow them regularly"]
    }
  ]
}'::jsonb
where id = 'ahs827sd';
