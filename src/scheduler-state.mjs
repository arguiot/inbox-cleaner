export class SchedulerState {
  constructor(db){this.db=db;}
  async mode(){return (await this.db.prepare("SELECT value FROM settings WHERE key='mode'").first())?.value;}
  async claim(owner,now=Date.now()){
    const r=await this.db.prepare(`INSERT INTO scheduler(id,owner,expires) VALUES(1,?,?)
      ON CONFLICT(id) DO UPDATE SET owner=excluded.owner,expires=excluded.expires WHERE expires < ? OR owner=?`)
      .bind(owner,now+300000,now,owner).run();
    return r.meta.changes===1;
  }
  async refresh(owner,now=Date.now()){
    const r=await this.db.prepare('UPDATE scheduler SET expires=? WHERE id=1 AND owner=?').bind(now+300000,owner).run();
    return r.meta.changes===1;
  }
  async handoff(owner,next,now=Date.now()){
    const r=await this.db.prepare('UPDATE scheduler SET owner=?,expires=? WHERE id=1 AND (owner=? OR owner=?)').bind(next,now+300000,owner,next).run();
    return r.meta.changes===1;
  }
  release(owner){return this.db.prepare('DELETE FROM scheduler WHERE id=1 AND owner=?').bind(owner).run();}
}
