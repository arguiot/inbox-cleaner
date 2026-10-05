CREATE TABLE settings(key TEXT PRIMARY KEY, value TEXT NOT NULL);
INSERT INTO settings(key,value) VALUES ('mode','preview');
CREATE TABLE scheduler(id INTEGER PRIMARY KEY, owner TEXT NOT NULL, expires INTEGER NOT NULL);
