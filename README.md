# VaultPass

Gestore di password e account, self-hosted e multi-utente, con cifratura **zero-knowledge**: i dati vengono cifrati e decifrati nel browser, e il server non vede mai le password principali né i dati in chiaro.

## Funzioni

- Più utenti possono usare la stessa installazione: ognuno crea il proprio utente (nome utente + password principale) dalla pagina principale, e ha un vault separato e cifrato con la propria chiave.
- Login all'app protetto dalla password principale di ciascun utente.
- Per ogni account: nome del sito, URL, email di accesso, nome utente, password (nascondibile), note.
- Ricerca per nome del sito, email o nome utente.
- Elenco delle email di accesso salvate (gestibile dalle Opzioni), suggerite quando aggiungi un nuovo account.
- Funziona da browser desktop e mobile come Progressive Web App (installabile come icona sul telefono).
- Collegamento con Google: **non ancora implementato** (vedi sezione "Limiti" più sotto).

## Come funziona la sicurezza (importante)

Quando un utente crea la propria password principale, il browser:

1. deriva localmente (PBKDF2, 210.000 iterazioni) una chiave a partire dalla password e da un "sale" casuale generato per quell'utente;
2. da questa chiave derivano due sotto-chiavi separate: una per autenticarsi col server (`authHash`) e una per cifrare/decifrare i propri dati (AES-GCM);
3. il server riceve e salva solo il nome utente, il sale, `authHash` (per verificare il login) e i dati già cifrati. Non riceve mai la password né la chiave di cifratura.

**Conseguenza importante**: se un utente dimentica la propria password principale, i suoi dati non sono recuperabili in alcun modo, nemmeno da chi gestisce il server. Ogni utente deve conservare la propria password in un posto sicuro (es. scritta su carta, o in un secondo password manager).

Non è ancora implementata una funzione di "cambio password principale" (richiederebbe di ridecifrare e ricifrare tutti gli account dell'utente).

La registrazione di nuovi utenti è aperta a chiunque possa raggiungere l'app (non c'è un invito o un'approvazione admin). Dopo aver creato i tuoi utenti puoi chiuderla impostando `ALLOW_REGISTRATION=false` (nel `.env` accanto al compose) e ricreando il container. Se esponi l'app oltre alla tua rete locale, proteggi l'accesso anche a livello di rete (Cloudflare Access, VPN, ecc.).

## Avvio con Docker (consigliato)

Basta il solo file `docker-compose.yml`: l'immagine `ghcr.io/jstplink/vaultpass-app` (x86_64 e arm64) viene costruita automaticamente da GitHub Actions a ogni push su `main`. Il file `.env` è facoltativo (vedi `.env.example`). Se `JWT_SECRET` non è impostato, viene generato automaticamente e salvato in `data/jwt_secret`.

```bash
docker compose up -d
```

L'app ascolta sulla porta 3000 e salva tutto in `./data/` (database e segreto delle sessioni), accanto al `docker-compose.yml`.

**L'app va aperta in HTTPS** (es. tramite Cloudflare Tunnel): il browser attiva le funzioni di cifratura (WebCrypto) solo su HTTPS o su `localhost`, quindi aprendola in `http://IP-del-NAS:3000` il login non funziona.

Per costruire l'immagine dal codice sorgente invece di scaricarla:

```bash
docker compose -f docker-compose.yml -f docker-compose.build.yml up -d --build
```

### Installazione su NAS Ugreen (UGOS Pro) con Cloudflare Tunnel

1. Apri l'app **Docker** → **Progetti** → **Crea**, scegli una cartella (es. `/volume1/docker/vaultpass`) e incolla il contenuto di `docker-compose.yml`. Avvia il progetto.
2. In Cloudflare Zero Trust crea un tunnel e aggiungi un "Public hostname" (es. `vault.tuodominio.it`) con servizio `HTTP` → `IP-del-NAS:3000`.
3. Apri `https://vault.tuodominio.it` e crea il tuo utente.

Con l'app esposta su Internet, dopo aver creato i tuoi utenti imposta `ALLOW_REGISTRATION=false` e/o proteggila con Cloudflare Access.

Per aggiornare: nell'app Docker scarica di nuovo l'immagine e ricrea il progetto (oppure via SSH `sudo docker compose pull && sudo docker compose up -d`). I dati in `data/` restano intatti.

## Avvio in locale senza Docker (sviluppo)

```bash
npm install
cp .env.example .env   # e imposta JWT_SECRET
npm start
```

Per provare l'interfaccia locale sui dati reali, imposta nel `.env` `REMOTE_URL=https://il-tuo-dominio`: le chiamate `/api` vengono inoltrate a quel server (attenzione: le modifiche fatte in locale finiscono sui dati veri). Senza `REMOTE_URL` l'app usa il database locale `data/vaultpass.db`.

## Backup

Basta copiare la cartella `data/` (i dati al suo interno sono già cifrati; ferma il container prima della copia, oppure copia insieme anche i file `vaultpass.db-wal` e `vaultpass.db-shm`). Consigliato un backup periodico automatico di questa cartella.

## Limiti attuali / cose rimandate

- Collegamento con Google per vedere i siti dove hai fatto accesso con l'account Google: **non esiste un'API pubblica di Google** che permetta a un'app come questa di leggere quella lista in automatico. È visibile solo manualmente su `myaccount.google.com/permissions`.
- Nessuna funzione di cambio password principale.
- Nessuna approvazione/invito per le nuove registrazioni: si possono solo aprire/chiudere con `ALLOW_REGISTRATION`.
