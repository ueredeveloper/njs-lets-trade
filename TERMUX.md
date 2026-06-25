# Termux (Android)

No Termux o Vite/Rollup costuma falhar (binários nativos opcionais do npm). O projeto usa **bundle pré-compilado** versionado em `frontend-react/dist/`.

## No PC (antes do push)

Após alterar o frontend React:

```bash
npm run build:frontend
git add frontend-react/dist
git commit -m "build frontend"
git push
```

## No Termux (após pull)

Só as dependências da raiz — **não** precisa de `npm install` em `frontend-react/`:

```bash
git pull
npm install
npm start
```

Com `TERMUX_VERSION` definido, `npm start` detecta o bundle e sobe só o Express na porta **3000** (UI + API no mesmo host).

Alternativa explícita:

```bash
npm run start:bundle
```

## Desenvolvimento no PC

```bash
npm run start:dev    # Vite (5173) + Express (3000)
npm run build:frontend
```

## Erro Rollup no Windows

Se `npm run start:dev` falhar com `@rollup/rollup-win32-x64-msvc`, veja [esta thread](https://stackoverflow.com/questions/77583341/cannot-find-module-rollup-rollup-win32-x64-msvc-npm-has-a-bug-related-to-optio). Atalho:

```bash
cd frontend-react
npm install @rollup/rollup-win32-x64-msvc
```

Ou gere o bundle no PC e use `npm run start:bundle` localmente para testar sem Vite.
