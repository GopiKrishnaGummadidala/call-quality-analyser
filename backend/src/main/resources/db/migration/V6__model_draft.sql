-- Model-assisted annotation: the speech model's first draft for a task, kept unchanged next to the annotation the
-- humans edit, so the app can show what the model wrote and measure how much annotators had to correct.
CREATE TABLE model_draft (
    task_id       VARCHAR(64)  PRIMARY KEY REFERENCES task (id),
    model_name    VARCHAR(200) NOT NULL,
    model_version VARCHAR(300) NOT NULL,
    provenance    VARCHAR(500) NOT NULL,
    segments_json TEXT         NOT NULL,
    created_at    TIMESTAMP WITH TIME ZONE NOT NULL
);
