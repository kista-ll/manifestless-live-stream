# Codex追加ルール

このファイルは、レビューや対話で判明した再発防止ルールを蓄積するための永続ルール集である。

Codexは作業開始時に、`AGENTS.md`、本ファイル、`docs/DECISIONS.md`を必ず読む。

## 運用原則

- ユーザーから「今後も守ること」「ルールに追加」「同じ指摘を繰り返さないこと」と明示された内容を追記する。
- 単発の実装修正、特定ファイルだけの変更、既存仕様と重複する内容は追記しない。
- 既存ルールと矛盾する場合は勝手に上書きせず、`Proposed`として記録する。
- アーキテクチャ判断は`docs/DECISIONS.md`へADRとして記録する。
- ルール追加と同じ変更内で、必要なテスト・テンプレート・ドキュメントも更新する。

## 登録形式

```markdown
## RULE-YYYYMMDD-NNN タイトル

Status: Active
Source: User feedback / Review / Incident
Scope: Repository / Server / Viewer / Tests / Documentation
Added: YYYY-MM-DD
Supersedes: なし

### Rule
実行可能な命令文で記載する。

### Rationale
追加理由と防止したい問題を記載する。

### Verification
確認方法を記載する。
```

## RULE-20260618-001 秘密情報と生成物をGit管理しない

Status: Active
Source: User feedback
Scope: Repository
Added: 2026-06-18
Supersedes: なし

### Rule

次をcommitまたはpushしてはならない。

- 秘密鍵、証明書、パスフレーズ
- `.env`およびローカル設定
- FFmpeg生成物
- ログ
- テスト結果、coverage、Playwrightレポート
- PythonおよびNode.jsの依存物・キャッシュ
- 一時ファイル

公開可能な設定は`.env.example`として管理し、生成ディレクトリは`.gitkeep`だけをcommitする。

### Verification

```bash
git status --ignored
git check-ignore -v .env certs/localhost.key media/live/segment-000001.m4s
```
