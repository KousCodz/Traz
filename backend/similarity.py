
import re
import io
import tokenize as python_tokenize


# ==================================================
# DOCUMENT TOKENIZATION
# ==================================================

def normalize_text(text):
    """Normalize document text for comparison."""
    return re.sub(r"\s+", " ", text.lower()).strip()


def tokenize(text):
    """Split document text into normalized words."""
    return re.findall(r"\b\w+\b", normalize_text(text))


# ==================================================
# DAA ALGORITHM 1: RABIN-KARP
# ==================================================

def rabin_karp_matches(
    sequence_a,
    sequence_b,
    pattern_length,
    base=256,
    modulus=1_000_000_007,
):
    """
    Return start-index pairs for equal contiguous windows using
    rolling hashes. Verify candidate matches token by token.
    """
    n, m = len(sequence_a), len(sequence_b)

    if pattern_length <= 0 or pattern_length > n or pattern_length > m:
        return []

    def token_value(token):
        value = 0
        for char in str(token):
            value = (value * base + ord(char) + 1) % modulus
        return value

    a = [token_value(token) for token in sequence_a]
    b = [token_value(token) for token in sequence_b]
    power = pow(base, pattern_length - 1, modulus)

    def window_hash(values):
        value = 0
        for item in values[:pattern_length]:
            value = (value * base + item) % modulus
        return value

    windows_b = {}
    rolling_b = window_hash(b)
    windows_b.setdefault(rolling_b, []).append(0)

    for start in range(1, m - pattern_length + 1):
        rolling_b = (
            (rolling_b - b[start - 1] * power) * base
            + b[start + pattern_length - 1]
        ) % modulus
        windows_b.setdefault(rolling_b, []).append(start)

    matches = []
    rolling_a = window_hash(a)

    for start_a in range(n - pattern_length + 1):
        if start_a:
            rolling_a = (
                (rolling_a - a[start_a - 1] * power) * base
                + a[start_a + pattern_length - 1]
            ) % modulus

        for start_b in windows_b.get(rolling_a, []):
            if (
                sequence_a[start_a:start_a + pattern_length]
                == sequence_b[start_b:start_b + pattern_length]
            ):
                matches.append((start_a, start_b))

    return matches


# ==================================================
# DAA ALGORITHM 2: LCS USING DYNAMIC PROGRAMMING
# ==================================================

def longest_common_subsequence(sequence_a, sequence_b):
    """Return one longest common subsequence using dynamic programming."""
    n, m = len(sequence_a), len(sequence_b)
    dp = [[0] * (m + 1) for _ in range(n + 1)]

    for i in range(1, n + 1):
        for j in range(1, m + 1):
            if sequence_a[i - 1] == sequence_b[j - 1]:
                dp[i][j] = dp[i - 1][j - 1] + 1
            else:
                dp[i][j] = max(dp[i - 1][j], dp[i][j - 1])

    result = []
    i, j = n, m

    while i > 0 and j > 0:
        if sequence_a[i - 1] == sequence_b[j - 1]:
            result.append(sequence_a[i - 1])
            i -= 1
            j -= 1
        elif dp[i - 1][j] >= dp[i][j - 1]:
            i -= 1
        else:
            j -= 1

    result.reverse()
    return result


def lcs_similarity_percentage(sequence_a, sequence_b):
    """Normalize LCS length against the longer token sequence."""
    if not sequence_a or not sequence_b:
        return 0.0

    common_length = len(longest_common_subsequence(sequence_a, sequence_b))
    return round(
        100 * common_length / max(len(sequence_a), len(sequence_b)),
        2,
    )


# ==================================================
# OVERALL SIMILARITY SCORE
# ==================================================

def rabin_karp_coverage_percentage(matches, token_count_a, token_count_b):
    """
    Calculate Rabin-Karp coverage using selected non-overlapping
    matching sequences.

    The denominator is the longer token sequence. Each selected
    matching sequence contributes its length once.
    """
    if token_count_a <= 0 or token_count_b <= 0:
        return 0.0

    matched_tokens = sum(match["token_count"] for match in matches)

    return round(
        100 * matched_tokens / max(token_count_a, token_count_b),
        2,
    )


def calculate_overall_similarity(rabin_karp_score, lcs_score):
    """
    Custom combined score: arithmetic mean of Rabin-Karp coverage
    and LCS similarity. Both inputs must be available.
    """
    if rabin_karp_score is None or lcs_score is None:
        return None

    return round((rabin_karp_score + lcs_score) / 2, 2)


# ==================================================
# DOCUMENT MATCHING PASSAGES
# ==================================================

def find_matching_passages(text_a, text_b, min_words=5):
    """Find maximal, non-overlapping exact word sequences using Rabin-Karp."""
    a, b = tokenize(text_a), tokenize(text_b)

    if not a or not b or min_words <= 0:
        return []

    seeds = set(rabin_karp_matches(a, b, min_words))
    candidates = set()

    for start_a, start_b in seeds:
        sa, sb = start_a, start_b

        while sa > 0 and sb > 0 and a[sa - 1] == b[sb - 1]:
            sa -= 1
            sb -= 1

        ea, eb = start_a + min_words, start_b + min_words

        while ea < len(a) and eb < len(b) and a[ea] == b[eb]:
            ea += 1
            eb += 1

        candidates.add((sa, ea, sb, eb))

    maximal = []

    for candidate in candidates:
        sa, ea, sb, eb = candidate

        if not any(
            other != candidate
            and other[0] <= sa and other[1] >= ea
            and other[2] <= sb and other[3] >= eb
            for other in candidates
        ):
            maximal.append(candidate)

    maximal.sort(key=lambda item: (-(item[1] - item[0]), item[0]))

    selected = []
    used_a, used_b = set(), set()

    for sa, ea, sb, eb in maximal:
        range_a = set(range(sa, ea))
        range_b = set(range(sb, eb))

        if range_a.isdisjoint(used_a) and range_b.isdisjoint(used_b):
            length = ea - sa

            selected.append({
                "word_count": length,
                "token_count": length,
                "start_a": sa + 1,
                "end_a": ea,
                "start_b": sb + 1,
                "end_b": eb,
                "passage": " ".join(a[sa:ea]),
            })

            used_a.update(range_a)
            used_b.update(range_b)

    return sorted(selected, key=lambda item: item["start_a"])


# ==================================================
# SOURCE CODE TOKENIZATION
# ==================================================

_CODE_PATTERN = re.compile(
    r'"(?:\\.|[^"\\])*"'
    r"|'(?:\\.|[^'\\])*'"
    r'|//[^\n]*'
    r'|/\*[\s\S]*?\*/'
    r'|[A-Za-z_$][A-Za-z0-9_$]*'
    r'|\d+(?:\.\d+)?'
    r'|==|!=|<=|>=|->|\+\+|--|&&|\|\||::|\+=|-=|\*=|/=|<<|>>'
    r'|[^\s]'
)


def _generic_tokens_with_lines(source):
    """Tokenize common C-style syntax and preserve line numbers."""
    tokens, lines = [], []

    for match in _CODE_PATTERN.finditer(source):
        token = match.group(0)

        if token.startswith("//") or token.startswith("/*"):
            continue

        tokens.append(token)
        lines.append(source.count("\n", 0, match.start()) + 1)

    return tokens, lines


def tokenize_generic_code(source):
    """Return generic source-code tokens."""
    return _generic_tokens_with_lines(source)[0]


def tokenize_python_code(source):
    """Tokenize Python while ignoring comments and formatting."""
    ignored = {
        python_tokenize.ENCODING,
        python_tokenize.NL,
        python_tokenize.NEWLINE,
        python_tokenize.INDENT,
        python_tokenize.DEDENT,
        python_tokenize.COMMENT,
        python_tokenize.ENDMARKER,
    }

    result = []

    try:
        for item in python_tokenize.generate_tokens(
            io.StringIO(source).readline
        ):
            if item.type not in ignored:
                result.append(item.string)

    except (python_tokenize.TokenError, IndentationError):
        return tokenize_generic_code(source)

    return result


def tokenize_code(source, language="generic"):
    """Return tokens for the requested language."""
    if language.lower() == "python":
        return tokenize_python_code(source)

    return tokenize_generic_code(source)


def tokenize_code_with_lines(source, language="generic"):
    """Return code tokens and their original line numbers."""
    if language.lower() != "python":
        return _generic_tokens_with_lines(source)

    ignored = {
        python_tokenize.ENCODING,
        python_tokenize.NL,
        python_tokenize.NEWLINE,
        python_tokenize.INDENT,
        python_tokenize.DEDENT,
        python_tokenize.COMMENT,
        python_tokenize.ENDMARKER,
    }

    tokens, lines = [], []

    try:
        for item in python_tokenize.generate_tokens(
            io.StringIO(source).readline
        ):
            if item.type not in ignored:
                tokens.append(item.string)
                lines.append(item.start[0])

        return tokens, lines

    except (python_tokenize.TokenError, IndentationError):
        return _generic_tokens_with_lines(source)


# ==================================================
# MATCHING CODE BLOCKS WITH LINE NUMBERS
# ==================================================

def find_matching_code_sequences(
    code_a,
    code_b,
    language="generic",
    min_tokens=5,
):
    """Find maximal exact matching code-token blocks using Rabin-Karp."""
    tokens_a, lines_a = tokenize_code_with_lines(code_a, language)
    tokens_b, lines_b = tokenize_code_with_lines(code_b, language)

    if not tokens_a or not tokens_b or min_tokens <= 0:
        return []

    # Preserve the existing safety limit for large source files.
    if len(tokens_a) > 5000 or len(tokens_b) > 5000:
        return []

    seeds = set(rabin_karp_matches(tokens_a, tokens_b, min_tokens))
    candidates = set()

    for start_a, start_b in seeds:
        sa, sb = start_a, start_b

        while (
            sa > 0 and sb > 0
            and tokens_a[sa - 1] == tokens_b[sb - 1]
        ):
            sa -= 1
            sb -= 1

        ea, eb = start_a + min_tokens, start_b + min_tokens

        while (
            ea < len(tokens_a) and eb < len(tokens_b)
            and tokens_a[ea] == tokens_b[eb]
        ):
            ea += 1
            eb += 1

        candidates.add((sa, ea, sb, eb))

    maximal = []

    for candidate in candidates:
        sa, ea, sb, eb = candidate

        if not any(
            other != candidate
            and other[0] <= sa and other[1] >= ea
            and other[2] <= sb and other[3] >= eb
            for other in candidates
        ):
            maximal.append(candidate)

    maximal.sort(key=lambda item: (-(item[1] - item[0]), item[0]))

    selected = []
    used_a, used_b = set(), set()

    for sa, ea, sb, eb in maximal:
        range_a = set(range(sa, ea))
        range_b = set(range(sb, eb))

        if range_a.isdisjoint(used_a) and range_b.isdisjoint(used_b):
            length = ea - sa

            selected.append({
                "word_count": length,
                "token_count": length,
                "start_a": sa + 1,
                "end_a": ea,
                "start_b": sb + 1,
                "end_b": eb,
                "line_start_a": lines_a[sa],
                "line_end_a": lines_a[ea - 1],
                "line_start_b": lines_b[sb],
                "line_end_b": lines_b[eb - 1],
                "passage": " ".join(tokens_a[sa:ea]),
            })

            used_a.update(range_a)
            used_b.update(range_b)

    return sorted(selected, key=lambda item: item["start_a"])
