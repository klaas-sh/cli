# TODO

## Future Features

### Full Session History (Premium Feature)

Currently, terminal output is kept in an in-memory ring buffer (256KB) that
provides scroll-back for recently connected web clients. However, this buffer
is lost when the Durable Object hibernates (after all connections close).

**For paying customers**, implement persistent full session history:

- Store complete terminal output to R2 or DO Storage
- Allow scrolling back through entire session history
- Provide session transcript downloads
- Consider compression for storage efficiency (terminal output compresses well)
- Add retention policies (e.g., 30 days for pro, 90 days for enterprise)

This would require:
1. Periodic writes to persistent storage (R2 recommended for large histories)
2. Chunked storage with index for efficient retrieval
3. API endpoint for fetching historical chunks
4. Dashboard UI for loading history on scroll
