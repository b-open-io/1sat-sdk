                                                                                     
  The transaction auto-commit problem is an IndexedDB fundamental, not an idb bug.     
  Dexie.js, the other major IndexedDB wrapper, has the exact same limitation and even  
  has a named error for it (PrematureCommitError).                                     
                                                                                       
  Viable Alternatives                                                                  
                                                                                       
  wa-sqlite + IDBBatchAtomicVFS is the standout option:                                
  - Real SQLite ACID transactions — BEGIN/COMMIT/ROLLBACK that actually work across    
  async boundaries                                                                     
  - Works directly in Chrome extension service workers (no workarounds needed)         
  - Uses IndexedDB as the persistence layer under the hood                             
  - Battle-tested (PowerSync uses it in production)                                    
  - Good performance for databases under ~100MB                                        
  - Your relational schema maps naturally to SQL tables                                
  - Requires 'wasm-unsafe-eval' in extension CSP                                       
                                                                                       
  PGlite (Postgres in WASM) is technically capable but has problems for extensions —   
  3MB binary, loads the entire DB into memory on startup, and service worker lifecycle 
  (frequent wake/sleep) means paying that bootstrap cost repeatedly.                   
                                                                                       
  Not Worth Pursuing                                                                   
                                                                                       
  - Dexie.js — same IndexedDB transaction problem, doesn't help                        
  - LokiJS — unmaintained, known data loss bugs                                        
  - RxDB — document/NoSQL model, bad fit for your relational schema, premium plugins   
  needed                                                                               
  - CRSQLite — CRDT overhead without benefit (your authority is the blockchain)        
  - sql.js — superseded by wa-sqlite, no built-in persistence                          
  - Official SQLite WASM — requires COOP/COEP headers, worse DX than wa-sqlite         
  - Raw OPFS — you'd be reinventing SQLite's transaction manager                       
                                                                                       
  Bottom Line                                                                          
                                                                                       
  Fixing the current idb approach (loading data outside transactions) is the right     
  short-term move. If you ever want to migrate away from IndexedDB's transaction model 
  entirely, wa-sqlite with IDBBatchAtomicVFS is the clear candidate — it gives you real
   SQL transactions that work in service workers, with IndexedDB as the durable backing
   store.                