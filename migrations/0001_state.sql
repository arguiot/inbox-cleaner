CREATE TABLE lease(id INTEGER PRIMARY KEY, owner TEXT NOT NULL, expires INTEGER NOT NULL);
CREATE TABLE budget(day TEXT PRIMARY KEY, used INTEGER NOT NULL);
CREATE TABLE cursors(account TEXT PRIMARY KEY, page TEXT);
CREATE TABLE messages(
  account TEXT NOT NULL, id TEXT NOT NULL, action TEXT NOT NULL,
  category TEXT NOT NULL, status TEXT NOT NULL, updated INTEGER NOT NULL,
  PRIMARY KEY(account,id)
);
CREATE INDEX messages_updated ON messages(updated);
