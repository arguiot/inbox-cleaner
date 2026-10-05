export class Store {
  constructor(db) { this.db = db; }
  async lease(owner, now) {
    const result = await this.db.prepare(`INSERT INTO lease (id,owner,expires) VALUES (1,?,?)
      ON CONFLICT(id) DO UPDATE SET owner=excluded.owner,expires=excluded.expires WHERE expires < ?`)
      .bind(owner, now + 120000, now).run();
    return result.meta.changes === 1;
  }
  release(owner) { return this.db.prepare('DELETE FROM lease WHERE id=1 AND owner=?').bind(owner).run(); }
  async reserve(day, limit) {
    const result = await this.db.prepare(`INSERT INTO budget(day,used) VALUES (?,1)
      ON CONFLICT(day) DO UPDATE SET used=used+1 WHERE used < ?`).bind(day,limit).run();
    return result.meta.changes === 1;
  }
  async cursor(account) {
    return (await this.db.prepare('SELECT page FROM cursors WHERE account=?').bind(account).first())?.page;
  }
  setCursor(account, page) {
    return this.db.prepare('INSERT INTO cursors(account,page) VALUES (?,?) ON CONFLICT(account) DO UPDATE SET page=excluded.page')
      .bind(account,page ?? null).run();
  }
  async seen(account, ids) {
    const seen=new Map();
    // D1 allows 100 bound parameters, including the account parameter.
    for (let offset=0;offset<ids.length;offset+=99) {
      const batch=ids.slice(offset,offset+99);
      const result=await this.db.prepare(`SELECT id,action,status FROM messages WHERE account=? AND id IN (${batch.map(()=>'?').join(',')})`)
        .bind(account,...batch).all();
      for (const row of result.results) seen.set(row.id,row);
    }
    return seen;
  }
  record(account,id,decision,status,now) {
    return this.db.prepare(`INSERT INTO messages(account,id,action,category,status,updated) VALUES (?,?,?,?,?,?)
      ON CONFLICT(account,id) DO UPDATE SET action=excluded.action,category=excluded.category,status=excluded.status,updated=excluded.updated`)
      .bind(account,id,decision.action,decision.category,status,now).run();
  }
  async prune(now) {
    await this.db.prepare('DELETE FROM messages WHERE updated < ?').bind(now - 45*86400000).run();
    await this.db.prepare('DELETE FROM budget WHERE day < ?').bind(new Date(now-3*86400000).toISOString().slice(0,10)).run();
  }
}
