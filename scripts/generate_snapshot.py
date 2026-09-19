#!/usr/bin/env python3
import os
import sys
import datetime
from pathlib import Path

ROOT_DIR = Path("/home/sandro/Área de trabalho/BackEnd")
OUTPUT_FILE = ROOT_DIR / "projeto-123-snapshot.txt"

# Pastas e arquivos a ignorar completamente
IGNORE_DIRS = {
    ".git",
    "node_modules",
    ".wrangler",
    ".idea",
    ".vscode",
    ".gemini",
    "coverage",
    "dist",
    "build",
    ".turbo",
    ".cache",
    "__pycache__",
    "scratch",
}

IGNORE_FILE_PATTERNS = {
    "projeto-123-snapshot.txt",
    "projeto-123-snapshot.txt.bak",
    ".dev.vars",
    ".gitignore",
}

IGNORE_EXTENSIONS = {
    ".db",
    ".db-journal",
    ".sqlite",
    ".sqlite3",
    ".xlsx",
    ".pdf",
    ".odt",
    ".png",
    ".jpg",
    ".jpeg",
    ".ico",
    ".gif",
    ".zip",
    ".tar",
    ".gz",
    ".pyc",
    ".bak",
}

def is_binary(file_path: Path) -> bool:
    try:
        with open(file_path, "tr", encoding="utf-8") as f:
            f.read(1024)
            return False
    except Exception:
        return True

def generate_tree(dir_path: Path, prefix: str = ""):
    lines = []
    items = []
    try:
        raw_items = sorted(os.listdir(dir_path))
    except PermissionError:
        return lines

    for item in raw_items:
        if item in IGNORE_DIRS:
            continue
        if any(item.endswith(ext) for ext in IGNORE_EXTENSIONS):
            continue
        if item.endswith("-snapshot.txt"):
            continue
        items.append(item)

    for index, item in enumerate(items):
        item_path = dir_path / item
        is_last = (index == len(items) - 1)
        connector = "└── " if is_last else "├── "
        lines.append(f"{prefix}{connector}{item}")

        if item_path.is_dir():
            extension = "    " if is_last else "│   "
            lines.extend(generate_tree(item_path, prefix + extension))

    return lines

def count_stats(dir_path: Path):
    dirs_count = 0
    files_count = 0
    for root, dirs, files in os.walk(dir_path):
        dirs[:] = [d for d in dirs if d not in IGNORE_DIRS]
        dirs_count += len(dirs)
        for f in files:
            if any(f.endswith(ext) for ext in IGNORE_EXTENSIONS):
                continue
            if f.endswith("-snapshot.txt"):
                continue
            files_count += 1
    return dirs_count, files_count

def collect_relevant_files(dir_path: Path):
    collected = []
    for root, dirs, files in os.walk(dir_path):
        dirs[:] = sorted([d for d in dirs if d not in IGNORE_DIRS])
        for f in sorted(files):
            if f in IGNORE_FILE_PATTERNS or f.endswith("-snapshot.txt"):
                continue
            if any(f.endswith(ext) for ext in IGNORE_EXTENSIONS):
                continue
            file_path = Path(root) / f
            if is_binary(file_path):
                continue
            rel_path = file_path.relative_to(dir_path)
            collected.append((rel_path, file_path))
    return sorted(collected, key=lambda x: str(x[0]))

def main():
    now_str = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    print(f"Gerando snapshot para {ROOT_DIR} em {now_str}...")

    tree_lines = ["."]
    tree_lines.extend(generate_tree(ROOT_DIR))
    dirs_count, files_count = count_stats(ROOT_DIR)
    tree_summary = f"\n{dirs_count} directories, {files_count} files\n"

    relevant_files = collect_relevant_files(ROOT_DIR)
    print(f"Total de arquivos relevantes de código/texto a incluir: {len(relevant_files)}")

    with open(OUTPUT_FILE, "w", encoding="utf-8") as out:
        out.write("============================================================\n")
        out.write(f"PROJETO: {ROOT_DIR}\n")
        out.write(f"DATA: {now_str}\n")
        out.write("============================================================\n\n")

        out.write("########################\n")
        out.write("# ÁRVORE\n")
        out.write("########################\n\n")
        out.write("\n".join(tree_lines))
        out.write(f"\n{tree_summary}\n\n")

        out.write("########################\n")
        out.write("# ARQUIVOS RELEVANTES\n")
        out.write("########################\n\n")

        for rel_path, abs_path in relevant_files:
            # Não incluir o próprio gerador se estiver dentro de scripts
            if rel_path.name == "generate_snapshot.py":
                continue
            
            print(f"Processando: ./{rel_path}")
            out.write("============================================================\n")
            out.write(f"ARQUIVO: ./{rel_path}\n")
            out.write("============================================================\n")
            try:
                with open(abs_path, "r", encoding="utf-8") as f:
                    content = f.read()
                    out.write(content)
                    if not content.endswith("\n"):
                        out.write("\n")
            except Exception as e:
                raise RuntimeError(f"FALHA CRÍTICA: Erro ao ler o arquivo {abs_path}: {e}")
            out.write("\n")

    size_mb = os.path.getsize(OUTPUT_FILE) / (1024 * 1024)
    print(f"Snapshot gerado com sucesso em {OUTPUT_FILE} ({size_mb:.2f} MB)")

if __name__ == "__main__":
    main()
