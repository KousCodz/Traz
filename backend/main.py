from pathlib import Path
from difflib import SequenceMatcher
import io

import fitz
from docx import Document
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from similarity import (
    find_matching_passages,
    find_matching_code_sequences,
    longest_common_subsequence,
    lcs_similarity_percentage,
    rabin_karp_coverage_percentage,
    calculate_overall_similarity,
    tokenize,
    tokenize_code,
)


app = FastAPI(
    title="TRACE API",
    description="Document Similarity and Code Plagiarism Analyser",
    version="1.3.1",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://127.0.0.1:5500",
        "http://localhost:5500",
    ],
    allow_credentials=False,
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type"],
)

MAX_FILE_SIZE = 10 * 1024 * 1024
MAX_TEXT_LENGTH = 200000

# LCS uses Dynamic Programming with quadratic time and memory costs.
# The limit applies independently to each input.
MAX_LCS_TOKENS = 1500

ALLOWED_EXTENSIONS = {".pdf", ".docx", ".txt"}

CODE_EXTENSIONS = {
    ".py": "python",
    ".cpp": "cpp",
    ".cc": "cpp",
    ".cxx": "cpp",
    ".hpp": "cpp",
    ".h": "cpp",
    ".c": "c",
    ".java": "java",
    ".js": "javascript",
    ".ts": "typescript",
    ".php": "php",
    ".cs": "csharp",
    ".go": "go",
    ".rs": "rust",
    ".txt": "generic",
}


def calculate_lcs_details(tokens_a: list, tokens_b: list) -> dict:
    """Calculate LCS details when both inputs fit the DP safety limit."""

    if not tokens_a or not tokens_b:
        return {
            "lcs_length": 0,
            "lcs_similarity_percentage": 0.0,
            "lcs_sequence": [],
            "lcs_available": True,
            "lcs_note": "LCS calculated using Dynamic Programming.",
        }

    if (
        len(tokens_a) > MAX_LCS_TOKENS
        or len(tokens_b) > MAX_LCS_TOKENS
    ):
        return {
            "lcs_length": None,
            "lcs_similarity_percentage": None,
            "lcs_sequence": [],
            "lcs_available": False,
            "lcs_note": (
                f"LCS was skipped because either input exceeds "
                f"the limit of {MAX_LCS_TOKENS} tokens for this "
                "Dynamic Programming implementation. "
                "Rabin-Karp results remain available, but the overall "
                "score is unavailable because it requires both scores."
            ),
        }

    sequence = longest_common_subsequence(tokens_a, tokens_b)

    return {
        "lcs_length": len(sequence),
        "lcs_similarity_percentage": lcs_similarity_percentage(
            tokens_a, tokens_b
        ),
        "lcs_sequence": sequence,
        "lcs_available": True,
        "lcs_note": "LCS calculated using Dynamic Programming.",
    }


def build_scores(matches, tokens_a, tokens_b, lcs_details):
    """Calculate Rabin-Karp, LCS and combined overall scores."""

    rabin_karp_score = rabin_karp_coverage_percentage(
        matches,
        len(tokens_a),
        len(tokens_b),
    )

    lcs_score = lcs_details["lcs_similarity_percentage"]

    overall_score = calculate_overall_similarity(
        rabin_karp_score,
        lcs_score,
    )

    return {
        "similarity_percentage": overall_score,
        "overall_similarity_percentage": overall_score,
        "rabin_karp_similarity_percentage": rabin_karp_score,
        "lcs_similarity_percentage": lcs_score,
        "method": (
            "Arithmetic mean of Rabin-Karp matching-token coverage "
            "and LCS similarity using Dynamic Programming"
        ),
    }


# ============================================================
# LINE-BY-LINE CODE DIFFERENCES
# ============================================================

def find_code_differences(code_a: str, code_b: str) -> list:
    lines_a = code_a.splitlines()
    lines_b = code_b.splitlines()

    matcher = SequenceMatcher(
        None,
        lines_a,
        lines_b,
        autojunk=True,
    )

    differences = []

    for tag, start_a, end_a, start_b, end_b in matcher.get_opcodes():
        if tag == "equal":
            continue

        differences.append({
            "type": tag,
            "line_start_a": start_a + 1 if start_a < end_a else None,
            "line_end_a": end_a if start_a < end_a else None,
            "line_start_b": start_b + 1 if start_b < end_b else None,
            "line_end_b": end_b if start_b < end_b else None,
            "lines_a": lines_a[start_a:end_a],
            "lines_b": lines_b[start_b:end_b],
        })

    return differences


# ============================================================
# GENERAL ROUTES
# ============================================================

@app.get("/")
def home():
    return {
        "message": "Welcome to TRACE",
        "status": "Backend is running",
    }


@app.get("/api/health")
def health_check():
    return {"status": "ok", "app": "TRACE"}


# ============================================================
# DOCUMENT TEXT EXTRACTION
# ============================================================

def extract_text(file_bytes: bytes, extension: str) -> str:
    if extension == ".txt":
        return file_bytes.decode("utf-8-sig")

    if extension == ".pdf":
        with fitz.open(stream=file_bytes, filetype="pdf") as pdf:
            if pdf.is_encrypted:
                raise ValueError(
                    "Password-protected PDFs are not supported."
                )

            return "\n".join(page.get_text() for page in pdf)

    if extension == ".docx":
        document = Document(io.BytesIO(file_bytes))
        paragraphs = [p.text for p in document.paragraphs]
        return "\n".join(paragraphs)

    raise ValueError("Unsupported file format.")


@app.post("/api/documents/extract")
async def extract_document(file: UploadFile = File(...)):
    filename = Path(file.filename or "").name
    extension = Path(filename).suffix.lower()

    if extension not in ALLOWED_EXTENSIONS:
        raise HTTPException(
            status_code=400,
            detail="Supported formats: PDF, DOCX and TXT.",
        )

    try:
        file_bytes = await file.read(MAX_FILE_SIZE + 1)

        if len(file_bytes) > MAX_FILE_SIZE:
            raise HTTPException(
                status_code=413,
                detail="File exceeds the 10 MB limit.",
            )

        text = extract_text(file_bytes, extension)

    except HTTPException:
        raise

    except (ValueError, UnicodeDecodeError) as exc:
        raise HTTPException(
            status_code=400,
            detail=str(exc),
        ) from exc

    except Exception as exc:
        raise HTTPException(
            status_code=400,
            detail=(
                "Could not read this file. Check that it is a "
                "valid, uncorrupted document."
            ),
        ) from exc

    finally:
        await file.close()

    return {
        "filename": filename,
        "characters_extracted": len(text),
        "text": text,
        "message": "Document text extraction completed.",
    }


# ============================================================
# DOCUMENT COMPARISON
# ============================================================

class CompareRequest(BaseModel):
    text_a: str = Field(max_length=MAX_TEXT_LENGTH)
    text_b: str = Field(max_length=MAX_TEXT_LENGTH)


@app.post("/api/compare")
def compare_documents(request: CompareRequest):
    words_a = tokenize(request.text_a)
    words_b = tokenize(request.text_b)

    # Rabin-Karp exact matching passage detection.
    matches = find_matching_passages(
        request.text_a,
        request.text_b,
        min_words=5,
    )

    # LCS using Dynamic Programming, subject to the token limit.
    lcs_details = calculate_lcs_details(words_a, words_b)

    scores = build_scores(matches, words_a, words_b, lcs_details)

    return {
        **scores,
        "matching_passages": matches,
        "matching_passage_count": len(matches),
        "rabin_karp_note": (
            "Rabin-Karp identifies exact contiguous word sequences. "
            "Its score is the matched-token coverage relative to the "
            "longer document token sequence."
        ),
        "lcs_length": lcs_details["lcs_length"],
        "lcs_sequence": lcs_details["lcs_sequence"],
        "lcs_available": lcs_details["lcs_available"],
        "lcs_note": lcs_details["lcs_note"],
        "notice": (
            "Overall Similarity is a custom arithmetic mean of the "
            "Rabin-Karp coverage score and LCS similarity score. "
            "These metrics identify similarities; they do not prove "
            "plagiarism."
        ),
    }


# ============================================================
# SOURCE CODE COMPARISON
# ============================================================

class CodeCompareRequest(BaseModel):
    filename_a: str = Field(min_length=1, max_length=255)
    filename_b: str = Field(min_length=1, max_length=255)
    code_a: str = Field(max_length=MAX_TEXT_LENGTH)
    code_b: str = Field(max_length=MAX_TEXT_LENGTH)


@app.post("/api/code/compare")
def compare_code(request: CodeCompareRequest):
    filename_a = Path(request.filename_a).name
    filename_b = Path(request.filename_b).name

    extension_a = Path(filename_a).suffix.lower()
    extension_b = Path(filename_b).suffix.lower()

    if extension_a not in CODE_EXTENSIONS:
        raise HTTPException(
            status_code=400,
            detail=(
                "Unsupported first code file type: "
                f"{extension_a or 'unknown'}."
            ),
        )

    if extension_b not in CODE_EXTENSIONS:
        raise HTTPException(
            status_code=400,
            detail=(
                "Unsupported second code file type: "
                f"{extension_b or 'unknown'}."
            ),
        )

    if not request.code_a.strip() or not request.code_b.strip():
        raise HTTPException(
            status_code=400,
            detail="Both code files must contain code.",
        )

    # Use Python tokenization only when both files are Python.
    if extension_a == ".py" and extension_b == ".py":
        language = "python"
    else:
        language = "generic"

    code_tokens_a = tokenize_code(request.code_a, language)
    code_tokens_b = tokenize_code(request.code_b, language)

    # Rabin-Karp matching code sequences.
    matches = find_matching_code_sequences(
        request.code_a,
        request.code_b,
        language=language,
        min_tokens=5,
    )

    # LCS using Dynamic Programming, subject to the token limit.
    lcs_details = calculate_lcs_details(
        code_tokens_a,
        code_tokens_b,
    )

    scores = build_scores(
        matches,
        code_tokens_a,
        code_tokens_b,
        lcs_details,
    )

    differences = find_code_differences(
        request.code_a,
        request.code_b,
    )

    return {
        "filename_a": filename_a,
        "filename_b": filename_b,
        **scores,
        "matching_passages": matches,
        "matching_passage_count": len(matches),
        "rabin_karp_note": (
            "Rabin-Karp identifies exact contiguous code-token sequences. "
            "Its score is the matched-token coverage relative to the "
            "longer code token sequence."
        ),
        "lcs_length": lcs_details["lcs_length"],
        "lcs_sequence": lcs_details["lcs_sequence"],
        "lcs_available": lcs_details["lcs_available"],
        "lcs_note": lcs_details["lcs_note"],
        "differences": differences,
        "difference_count": len(differences),
        "notice": (
            "Overall Similarity is a custom arithmetic mean of Rabin-Karp "
            "coverage and LCS similarity using Dynamic Programming. "
            "Comments and whitespace are ignored where supported. "
            "Similarity alone does not prove plagiarism."
        ),
    }