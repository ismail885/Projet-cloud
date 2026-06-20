const os = require("os");
const express = require("express");
const { Pool } = require("pg");

const app = express();
app.use(express.urlencoded({ extended: false }));

// Paramètres de connexion injectés via variables d'environnement par docker-compose (voir compose.yml du rôle "app").
const pool = new Pool({
  host: process.env.DB_HOST || "db",
  port: parseInt(process.env.DB_PORT || "5432", 10),
  database: process.env.DB_NAME || "techapp",
  user: process.env.DB_USER || "techapp",
  password: process.env.DB_PASSWORD || "changeme",
  connectionTimeoutMillis: 5000,
});

const PORT = parseInt(process.env.APP_PORT || "8000", 10);

// Attend que PostgreSQL réponde avant de démarrer (au premier boot, la base n'est pas toujours prête) puis crée la table si besoin.
async function initDb(retries = 30) {
  for (let i = 1; i <= retries; i++) {
    try {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS memos (
          id     SERIAL PRIMARY KEY,
          auteur TEXT NOT NULL,
          texte  TEXT NOT NULL,
          cree_le TIMESTAMP DEFAULT NOW()
        );
      `);
      console.log("Base joignable, schéma prêt.");
      return;
    } catch (err) {
      console.log(`Base pas encore prête (tentative ${i}/${retries}) : ${err.code || err.message}`);
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
  throw new Error("Impossible de joindre la base après plusieurs tentatives.");
}

function escape(s) {
  return String(s).replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
  ));
}

function page(memos) {
  const lignes = memos.map((m) => `
      <li class="memo">
        <p class="texte">${escape(m.texte)}</p>
        <span class="meta">— ${escape(m.auteur)}, ${new Date(m.cree_le).toLocaleString("fr-FR")}</span>
      </li>`).join("");

  return `<!doctype html>
<html lang="fr">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Mémos d'équipe — intranet</title>
  <style>
    :root { --bg:#0f172a; --panel:#1e293b; --line:#334155; --accent:#0ea5a4; --txt:#e2e8f0; --muted:#94a3b8; }
    * { box-sizing:border-box; }
    body { font-family:system-ui,Segoe UI,Helvetica,Arial,sans-serif; background:var(--bg);
           color:var(--txt); margin:0; min-height:100vh; display:flex; justify-content:center; padding:3rem 1rem; }
    .wrap { width:100%; max-width:680px; }
    header { border-left:4px solid var(--accent); padding-left:1rem; margin-bottom:2rem; }
    h1 { margin:0 0 .25rem; font-size:1.6rem; }
    .sous { color:var(--muted); font-size:.9rem; margin:0; }
    form { background:var(--panel); border:1px solid var(--line); border-radius:12px; padding:1.25rem; margin-bottom:1.5rem; }
    input, textarea { width:100%; background:#0b1220; border:1px solid var(--line); color:var(--txt);
                      border-radius:8px; padding:.65rem .8rem; font-size:.95rem; margin-bottom:.75rem; font-family:inherit; }
    button { background:var(--accent); color:#06251f; border:none; font-weight:700; padding:.6rem 1.3rem;
             border-radius:8px; cursor:pointer; font-size:.95rem; }
    ul { list-style:none; padding:0; margin:0; }
    .memo { background:var(--panel); border:1px solid var(--line); border-left:3px solid var(--accent);
            border-radius:10px; padding:.9rem 1.1rem; margin-bottom:.75rem; }
    .texte { margin:0 0 .4rem; }
    .meta { color:var(--muted); font-size:.8rem; }
    footer { color:var(--muted); font-size:.78rem; margin-top:2rem; text-align:center; line-height:1.6; }
    code { color:var(--accent); }
  </style>
</head>
<body>
  <div class="wrap">
    <header>
      <h1>Mémos d'équipe</h1>
      <p class="sous">Petit outil interne de démonstration — chaîne reverse proxy → app → base</p>
    </header>

    <form method="post" action="/memos">
      <input name="auteur" placeholder="Votre nom" maxlength="60" required>
      <textarea name="texte" placeholder="Votre mémo…" rows="2" maxlength="280" required></textarea>
      <button type="submit">Publier</button>
    </form>

    <ul>${lignes || '<li class="meta">Aucun mémo pour l\'instant.</li>'}</ul>

    <footer>
      Servi par le conteneur applicatif <code>${escape(os.hostname())}</code><br>
      Node.js + Express · base PostgreSQL sur ${escape(process.env.DB_HOST || "db")}
    </footer>
  </div>
</body>
</html>`;
}

app.get("/", async (req, res) => {
  try {
    const { rows } = await pool.query(
      "SELECT auteur, texte, cree_le FROM memos ORDER BY cree_le DESC LIMIT 50;"
    );
    res.send(page(rows));
  } catch (err) {
    res.status(503).send("Service indisponible : " + escape(err.message));
  }
});

app.post("/memos", async (req, res) => {
  const auteur = (req.body.auteur || "").trim().slice(0, 60);
  const texte = (req.body.texte || "").trim().slice(0, 280);
  if (auteur && texte) {
    await pool.query("INSERT INTO memos (auteur, texte) VALUES ($1, $2);", [auteur, texte]);
  }
  res.redirect("/");
});

// Endpoint de santé utilisé par le reverse proxy / la supervision.
app.get("/health", async (req, res) => {
  try {
    await pool.query("SELECT 1;");
    res.json({ status: "ok" });
  } catch (err) {
    res.status(503).json({ status: "ko", error: err.message });
  }
});

initDb()
  .then(() => app.listen(PORT, "0.0.0.0", () => console.log(`App à l'écoute sur :${PORT}`)))
  .catch((err) => { console.error(err); process.exit(1); });
