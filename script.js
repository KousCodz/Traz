
"use strict";

/* ============================================================
   TRACE CONFIGURATION
   ============================================================ */

const root = document.documentElement;
const API_BASE = "http://127.0.0.1:8000";
const MAX_FILE_SIZE = 10 * 1024 * 1024;
const MAX_TEXT_LENGTH = 200000;

const pageNames = {
  dashboard: "Overview",
  documents: "Document analysis",
  code: "Code comparison",
  method: "Methodology",
  about: "About TRACE"
};

/* ============================================================
   NAVIGATION
   ============================================================ */

const navLinks = document.querySelectorAll("[data-page]");
const pages = document.querySelectorAll(".page");
const currentSection = document.getElementById("currentSection");

function showPage(pageId) {
  if (!pageNames[pageId] || !document.getElementById(pageId)) {
    pageId = "dashboard";
  }

  pages.forEach((page) => {
    page.hidden = page.id !== pageId;
  });

  navLinks.forEach((link) => {
    const active = link.dataset.page === pageId;
    link.classList.toggle("active", active);

    if (active) {
      link.setAttribute("aria-current", "page");
    } else {
      link.removeAttribute("aria-current");
    }
  });

  if (currentSection) {
    currentSection.textContent = pageNames[pageId];
  }

  document.title = `${pageNames[pageId]} | TRACE`;
}

function handleNavigation() {
  showPage(window.location.hash.slice(1) || "dashboard");
}

window.addEventListener("hashchange", handleNavigation);

navLinks.forEach((element) => {
  if (element.tagName === "A" || element.tagName === "BUTTON") return;

  element.addEventListener("click", (event) => {
    const pageId = element.dataset.page;

    if (!pageNames[pageId]) return;

    event.preventDefault();
    window.location.hash = pageId;
  });
});

handleNavigation();

/* ============================================================
   THEME
   ============================================================ */

const themeToggle = document.getElementById("themeToggle");
const themeLabel = document.getElementById("themeLabel");
const themeIcon = document.getElementById("themeIcon");

function applyTheme(theme) {
  const isDark = theme === "dark";

  if (isDark) {
    root.dataset.theme = "dark";
  } else {
    delete root.dataset.theme;
  }

  if (themeLabel) {
    themeLabel.textContent = isDark
      ? "Switch to light mode"
      : "Switch to dark mode";
  }

  if (themeIcon) {
    themeIcon.textContent = isDark ? "☼" : "◐";
  }

  if (themeToggle) {
    themeToggle.setAttribute("aria-pressed", String(isDark));
    themeToggle.setAttribute(
      "aria-label",
      isDark ? "Switch to light mode" : "Switch to dark mode"
    );
  }
}

if (themeToggle) {
  themeToggle.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();

    applyTheme(root.dataset.theme === "dark" ? "light" : "dark");
  });
}

applyTheme("light");

/* ============================================================
   SHARED HELPERS
   ============================================================ */

function showFeedback(element, message) {
  if (!element) return;

  element.replaceChildren();

  const paragraph = document.createElement("p");
  paragraph.textContent = message;
  element.appendChild(paragraph);
}

function getErrorMessage(data, fallback) {
  if (typeof data?.detail === "string") {
    return data.detail;
  }

  if (Array.isArray(data?.detail)) {
    return data.detail
      .map((item) => item.msg || "Invalid request")
      .join("; ");
  }

  return fallback;
}

async function readJsonResponse(response, fallback) {
  let data;

  try {
    data = await response.json();
  } catch {
    throw new Error(
      `The server returned an unreadable response (HTTP ${response.status}).`
    );
  }

  if (!response.ok) {
    throw new Error(getErrorMessage(data, fallback));
  }

  return data;
}

async function postJson(url, body, fallback) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });

  return readJsonResponse(response, fallback);
}

function appendTextElement(parent, tag, text, className = "") {
  const element = document.createElement(tag);
  element.textContent = String(text ?? "");

  if (className) element.className = className;

  parent.appendChild(element);
  return element;
}

function formatPercentage(value) {
  if (value === null || value === undefined || value === "") {
    return "Unavailable";
  }

  const number = Number(value);

  if (!Number.isFinite(number)) return "Unavailable";

  return `${Math.min(100, Math.max(0, number)).toFixed(2)}%`;
}

function getSimilarityLabel(value) {
  if (value < 20) return "Low similarity";
  if (value < 50) return "Moderate similarity";
  return "High similarity";
}

function updateProgress(value, levelId, progressId, fillId) {
  const level = document.getElementById(levelId);
  const progress = document.getElementById(progressId);
  const fill = document.getElementById(fillId);

  const score = Number(value);
  const validScore = Number.isFinite(score)
    ? Math.min(100, Math.max(0, score))
    : 0;

  const unavailable =
    value === null ||
    value === undefined ||
    value === "" ||
    !Number.isFinite(score);

  if (fill) {
    fill.style.width = `${unavailable ? 0 : validScore}%`;
  }

  if (progress) {
    progress.setAttribute("aria-valuemin", "0");
    progress.setAttribute("aria-valuemax", "100");
    progress.setAttribute("aria-valuenow", String(unavailable ? 0 : validScore));
    progress.setAttribute(
      "aria-valuetext",
      unavailable
        ? "Similarity unavailable"
        : `${validScore.toFixed(2)} percent similarity`
    );
  }

  if (level) {
    level.textContent = unavailable
      ? "Unavailable"
      : getSimilarityLabel(validScore);
  }
}

function updateSimilarityDisplay(value) {
  updateProgress(
    value,
    "documentLevel",
    "documentProgress",
    "documentProgressFill"
  );
}

function updateCodeSimilarityDisplay(value) {
  updateProgress(
    value,
    "codeLevel",
    "codeProgress",
    "codeProgressFill"
  );
}

function getOverallSimilarity(comparison) {
  if (comparison.lcs_available === false) return null;

  const value =
    comparison.overall_similarity_percentage ??
    comparison.similarity_percentage;

  if (value === null || value === undefined || value === "") return null;

  return Number.isFinite(Number(value)) ? Number(value) : null;
}

function validateComparisonScore(comparison) {
  const score = getOverallSimilarity(comparison);

  if (score === null) {
    throw new Error(
      comparison.lcs_note ||
      "The backend did not return a valid overall similarity score. Check the API response and LCS token limit."
    );
  }

  return score;
}

/* ============================================================
   INPUT MODE SWITCHING
   ============================================================ */

function configureInputMode(config) {
  const {
    uploadButtonId,
    textButtonId,
    uploadPanelId,
    textPanelId,
    resultsId,
    feedbackElement,
    initialMessage
  } = config;

  const uploadButton = document.getElementById(uploadButtonId);
  const textButton = document.getElementById(textButtonId);
  const uploadPanel = document.getElementById(uploadPanelId);
  const textPanel = document.getElementById(textPanelId);
  const results = document.getElementById(resultsId);

  let mode = "upload";

  function setMode(nextMode) {
    mode = nextMode === "text" ? "text" : "upload";

    const textMode = mode === "text";

    if (uploadPanel) uploadPanel.hidden = textMode;
    if (textPanel) textPanel.hidden = !textMode;

    if (uploadButton) {
      uploadButton.classList.toggle("active", !textMode);
      uploadButton.setAttribute("aria-pressed", String(!textMode));
    }

    if (textButton) {
      textButton.classList.toggle("active", textMode);
      textButton.setAttribute("aria-pressed", String(textMode));
    }

    if (results) results.hidden = true;

    if (feedbackElement) {
      showFeedback(
        feedbackElement,
        textMode
          ? "Paste both inputs into the text boxes to begin."
          : initialMessage
      );
    }
  }

  if (uploadButton) {
    uploadButton.addEventListener("click", () => setMode("upload"));
  }

  if (textButton) {
    textButton.addEventListener("click", () => setMode("text"));
  }

  setMode("upload");

  return {
    getMode: () => mode,
    setMode
  };
}

/* ============================================================
   TEXT CHARACTER COUNTERS
   ============================================================ */

function setupCharacterCounter(textareaId, counterId) {
  const textarea = document.getElementById(textareaId);
  const counter = document.getElementById(counterId);

  if (!textarea || !counter) return;

  function updateCounter() {
    const length = textarea.value.length;

    counter.textContent =
      `${length.toLocaleString()} / ${MAX_TEXT_LENGTH.toLocaleString()}`;

    counter.classList.toggle("limit-reached", length >= MAX_TEXT_LENGTH);
  }

  textarea.maxLength = MAX_TEXT_LENGTH;
  textarea.addEventListener("input", updateCounter);
  updateCounter();
}

setupCharacterCounter("documentTextA", "documentTextACount");
setupCharacterCounter("documentTextB", "documentTextBCount");
setupCharacterCounter("codeTextA", "codeTextACount");
setupCharacterCounter("codeTextB", "codeTextBCount");

/* ============================================================
   ALGORITHM SCORE DETAILS
   ============================================================ */

function renderAlgorithmScores(prefix, comparison) {
  const results = document.getElementById(
    prefix === "document" ? "documentResults" : "codeResults"
  );

  if (!results) return;

  let panel = document.getElementById(`${prefix}AlgorithmScores`);

  if (!panel) {
    panel = document.createElement("section");
    panel.id = `${prefix}AlgorithmScores`;
    panel.className = "algorithm-score-details";

    appendTextElement(panel, "h3", "Algorithm breakdown");

    appendTextElement(
      panel,
      "p",
      "Overall similarity is a custom average of Rabin-Karp matching coverage and LCS similarity. It is not a standardized plagiarism score.",
      "algorithm-score-note"
    );

    const list = document.createElement("div");
    list.className = "algorithm-score-list";
    list.id = `${prefix}AlgorithmScoreList`;
    panel.appendChild(list);

    const existingLcs = document.getElementById(`${prefix}LcsResults`);

    if (existingLcs && existingLcs.parentElement === results) {
      results.insertBefore(panel, existingLcs);
    } else {
      results.appendChild(panel);
    }
  }

  const list = document.getElementById(`${prefix}AlgorithmScoreList`);
  if (!list) return;

  list.replaceChildren();

  const rows = [
    {
      label: "Overall similarity",
      value: getOverallSimilarity(comparison),
      description: "Custom average of the two algorithm scores."
    },
    {
      label: "Rabin-Karp score",
      value: comparison.rabin_karp_similarity_percentage,
      description: "Coverage of matching token sequences."
    },
    {
      label: "LCS score",
      value: comparison.lcs_available === false
        ? null
        : comparison.lcs_similarity_percentage,
      description: "Similarity based on the longest common subsequence."
    }
  ];

  rows.forEach((row) => {
    const card = document.createElement("article");
    card.className = "algorithm-score-card";

    appendTextElement(card, "h4", row.label);
    appendTextElement(
      card,
      "p",
      formatPercentage(row.value),
      "algorithm-score-value"
    );
    appendTextElement(
      card,
      "p",
      row.description,
      "algorithm-score-description"
    );

    list.appendChild(card);
  });

  const oldWarning = panel.querySelector(".algorithm-score-warning");
  if (oldWarning) oldWarning.remove();

  if (comparison.lcs_available === false) {
    appendTextElement(
      panel,
      "p",
      comparison.lcs_note ||
        "LCS was unavailable for this input. The overall score is therefore unavailable.",
      "algorithm-score-warning"
    );
  }
}

/* ============================================================
   DOCUMENT MATCH RESULTS
   ============================================================ */

function renderMatches(listElement, matches, emptyMessage) {
  if (!listElement) return;

  listElement.replaceChildren();

  if (!Array.isArray(matches) || matches.length === 0) {
    appendTextElement(listElement, "li", emptyMessage);
    return;
  }

  matches.forEach((match, index) => {
    const item = document.createElement("li");
    const count = Number(match.word_count ?? match.token_count) || 0;

    appendTextElement(
      item,
      "strong",
      `Match ${index + 1}: ${count} matching words`
    );

    appendTextElement(
      item,
      "p",
      String(match.passage || "") || "(Passage unavailable)"
    );

    listElement.appendChild(item);
  });
}

/* ============================================================
   CODE MATCH RESULTS
   ============================================================ */

function renderCodeMatches(listElement, matches, emptyMessage) {
  if (!listElement) return;

  listElement.replaceChildren();

  if (!Array.isArray(matches) || matches.length === 0) {
    appendTextElement(listElement, "li", emptyMessage);
    return;
  }

  matches.forEach((match, index) => {
    const item = document.createElement("li");
    item.className = "code-match-item";

    const count = Number(match.token_count ?? match.word_count) || 0;

    appendTextElement(
      item,
      "h4",
      `Match ${index + 1}: ${count} matching tokens`
    );

    const hasLineNumbers =
      Number.isFinite(Number(match.line_start_a)) &&
      Number.isFinite(Number(match.line_end_a)) &&
      Number.isFinite(Number(match.line_start_b)) &&
      Number.isFinite(Number(match.line_end_b));

    if (hasLineNumbers) {
      appendTextElement(
        item,
        "p",
        `File A: lines ${match.line_start_a}-${match.line_end_a}`
      );

      appendTextElement(
        item,
        "p",
        `File B: lines ${match.line_start_b}-${match.line_end_b}`
      );
    } else {
      appendTextElement(
        item,
        "p",
        "Line numbers are not available for this match."
      );
    }

    appendTextElement(
      item,
      "pre",
      String(match.passage || "") || "(Matching code unavailable)",
      "matching-code-passage"
    );

    listElement.appendChild(item);
  });
}

/* ============================================================
   LONGEST COMMON SUBSEQUENCE RESULTS
   ============================================================ */

function renderLcsResults(prefix, comparison, unitLabel) {
  const container = document.getElementById(`${prefix}LcsResults`);
  if (!container) return;

  container.replaceChildren();
  container.hidden = false;

  appendTextElement(container, "h3", "Longest Common Subsequence (LCS)");

  if (comparison.lcs_available === false) {
    appendTextElement(
      container,
      "p",
      comparison.lcs_note ||
        "LCS was not calculated because the input exceeded the configured token limit."
    );
    return;
  }

  const length = Number(comparison.lcs_length);
  const percentage = comparison.lcs_similarity_percentage;

  const sequence = Array.isArray(comparison.lcs_sequence)
    ? comparison.lcs_sequence
    : [];

  const stats = document.createElement("div");
  stats.className = "lcs-statistics";

  appendTextElement(
    stats,
    "p",
    `LCS length: ${Number.isFinite(length) ? length : 0} ${unitLabel}`
  );

  appendTextElement(
    stats,
    "p",
    `LCS similarity: ${formatPercentage(percentage)}`
  );

  container.appendChild(stats);
  appendTextElement(container, "h4", "Longest common sequence");

  if (sequence.length === 0) {
    appendTextElement(container, "p", "No common subsequence was found.");
    return;
  }

  const sequenceText = sequence.join(" ");

  appendTextElement(
    container,
    unitLabel === "tokens" ? "pre" : "p",
    sequenceText,
    "lcs-sequence"
  );
}

/* ============================================================
   LINE-BY-LINE CODE DIFFERENCES
   ============================================================ */

function renderCodeDifferences(
  resultsElement,
  differences,
  filenameA,
  filenameB
) {
  if (!resultsElement) return;

  let section = document.getElementById("codeDifferenceResults");

  if (!section) {
    section = document.createElement("section");
    section.id = "codeDifferenceResults";
    section.className = "code-difference-results";
  }

  if (section.parentElement !== resultsElement) {
    resultsElement.appendChild(section);
  }

  section.hidden = false;
  section.replaceChildren();

  appendTextElement(section, "h3", "Line-by-Line Differences");

  appendTextElement(
    section,
    "p",
    "Removed lines appear in File A. Added lines appear in File B. Unchanged lines are omitted."
  );

  if (!Array.isArray(differences)) {
    appendTextElement(
      section,
      "p",
      "The backend did not return a differences list."
    );
    return;
  }

  if (differences.length === 0) {
    appendTextElement(
      section,
      "p",
      "No line-by-line differences were returned."
    );
    return;
  }

  const grid = document.createElement("div");
  grid.className = "code-difference-grid";

  const columnA = document.createElement("div");
  columnA.className = "code-difference-column";

  const columnB = document.createElement("div");
  columnB.className = "code-difference-column";

  appendTextElement(columnA, "h4", `File A: ${filenameA}`);
  appendTextElement(columnB, "h4", `File B: ${filenameB}`);

  grid.append(columnA, columnB);
  section.appendChild(grid);

  let displayedChanges = 0;

  differences.forEach((difference, index) => {
    const type = difference?.type;

    if (!["replace", "insert", "delete"].includes(type)) return;

    displayedChanges++;

    const blockA = document.createElement("div");
    blockA.className = `code-difference-block difference-${type}`;

    const blockB = document.createElement("div");
    blockB.className = `code-difference-block difference-${type}`;

    appendTextElement(
      blockA,
      "strong",
      `Change ${index + 1}: ${
        type === "insert" ? "No removed lines" : "Previous lines"
      }`
    );

    appendTextElement(
      blockB,
      "strong",
      `Change ${index + 1}: ${
        type === "delete" ? "No added lines" : "New lines"
      }`
    );

    const linesA = Array.isArray(difference.lines_a)
      ? difference.lines_a
      : [];

    const linesB = Array.isArray(difference.lines_b)
      ? difference.lines_b
      : [];

    function appendLines(block, lines, startValue) {
      if (lines.length === 0) {
        appendTextElement(block, "p", "No corresponding lines.");
        return;
      }

      const pre = document.createElement("pre");
      pre.className = "difference-code";

      lines.forEach((line, lineIndex) => {
        const row = document.createElement("div");
        row.className = "difference-line";

        const startLine = Number(startValue);
        const lineNumber = Number.isFinite(startLine)
          ? startLine + lineIndex
          : "-";

        appendTextElement(row, "span", lineNumber, "line-number");
        appendTextElement(row, "code", line, "line-content");

        pre.appendChild(row);
      });

      block.appendChild(pre);
    }

    appendLines(blockA, linesA, difference.line_start_a);
    appendLines(blockB, linesB, difference.line_start_b);

    columnA.appendChild(blockA);
    columnB.appendChild(blockB);
  });

  if (displayedChanges === 0) {
    appendTextElement(
      section,
      "p",
      "No supported difference entries were returned."
    );
  }
}

window.renderCodeDifferences = renderCodeDifferences;

/* ============================================================
   FILE SELECTION HELPERS
   ============================================================ */

function isSameFile(a, b) {
  return (
    a.name === b.name &&
    a.size === b.size &&
    a.lastModified === b.lastModified
  );
}

function addFilesToSelection(incomingFiles, selectedFiles) {
  let limitReached = false;

  for (const file of incomingFiles) {
    if (selectedFiles.some((existing) => isSameFile(existing, file))) {
      continue;
    }

    if (selectedFiles.length >= 2) {
      limitReached = true;
      break;
    }

    selectedFiles.push(file);
  }

  return limitReached;
}

function renderSelectedFiles({
  selectedFiles,
  container,
  results,
  updateFeedback,
  label
}) {
  if (!container) return;

  container.replaceChildren();

  if (selectedFiles.length === 0) return;

  const list = document.createElement("ul");

  selectedFiles.forEach((file, index) => {
    const item = document.createElement("li");
    item.className = "selected-document-item";

    const fileName = document.createElement("span");
    fileName.className = "selected-document-name";
    fileName.textContent =
      `${file.name} (${(file.size / 1024).toFixed(1)} KB)`;

    const removeButton = document.createElement("button");
    removeButton.type = "button";
    removeButton.className = "remove-document-button";
    removeButton.textContent = "×";
    removeButton.setAttribute("aria-label", `Remove ${file.name}`);
    removeButton.title = `Remove ${label}`;

    removeButton.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();

      selectedFiles.splice(index, 1);

      if (results) results.hidden = true;

      renderSelectedFiles({
        selectedFiles,
        container,
        results,
        updateFeedback,
        label
      });

      updateFeedback();
    });

    item.append(fileName, removeButton);
    list.appendChild(item);
  });

  container.appendChild(list);
}

/* ============================================================
   SHARED COMPARISON RESPONSE RENDERER
   ============================================================ */

function renderComparisonResults(config, comparison) {
  const {
    results,
    scoreElement,
    methodElement,
    matchCountElement,
    matchList,
    prefix,
    unitLabel,
    isCode,
    filenameA,
    filenameB
  } = config;

  const rawSimilarity = validateComparisonScore(comparison);

  scoreElement.textContent = formatPercentage(rawSimilarity);

  if (isCode) {
    updateCodeSimilarityDisplay(rawSimilarity);
  } else {
    updateSimilarityDisplay(rawSimilarity);
  }

  methodElement.textContent =
    `Method: ${comparison.method || "Rabin-Karp and LCS"}`;

  const matches = Array.isArray(comparison.matching_passages)
    ? comparison.matching_passages
    : [];

  matchCountElement.textContent = isCode
    ? `${matches.length} matching sequence(s) found`
    : `${matches.length} matching passage(s) found`;

  if (isCode) {
    renderCodeMatches(
      matchList,
      matches,
      "No matching sequences of five or more tokens found."
    );
  } else {
    renderMatches(
      matchList,
      matches,
      "No matching passages of five or more words found."
    );
  }

  renderAlgorithmScores(prefix, comparison);
  renderLcsResults(prefix, comparison, unitLabel);

  if (isCode) {
    renderCodeDifferences(
      results,
      comparison.differences,
      filenameA,
      filenameB
    );
  }

  results.hidden = false;
}

/* ============================================================
   DOCUMENT ANALYSIS: UPLOAD OR PASTE
   ============================================================ */

const documentInput = document.getElementById("documentFiles");
const documentButton = document.getElementById("documentPrepare");
const documentFeedback = document.getElementById("documentFeedback");
const selectedNames = document.getElementById("selectedDocumentNames");
const documentResults = document.getElementById("documentResults");

const documentTextA = document.getElementById("documentTextA");
const documentTextB = document.getElementById("documentTextB");

const selectedDocumentFiles = [];

const documentMode = configureInputMode({
  uploadButtonId: "documentUploadMode",
  textButtonId: "documentTextMode",
  uploadPanelId: "documentUploadPanel",
  textPanelId: "documentTextPanel",
  resultsId: "documentResults",
  feedbackElement: documentFeedback,
  initialMessage: "Select two documents to begin."
});

function updateDocumentFeedback(message = "") {
  showFeedback(
    documentFeedback,
    message ||
      `${selectedDocumentFiles.length} of 2 documents selected.`
  );
}

function updateDocumentFileList() {
  renderSelectedFiles({
    selectedFiles: selectedDocumentFiles,
    container: selectedNames,
    results: documentResults,
    updateFeedback: updateDocumentFeedback,
    label: "document"
  });
}

if (documentInput) {
  documentInput.addEventListener("change", () => {
    const incoming = Array.from(documentInput.files || []);
    const limitReached = addFilesToSelection(
      incoming,
      selectedDocumentFiles
    );

    documentInput.value = "";

    if (documentResults) documentResults.hidden = true;

    updateDocumentFileList();

    updateDocumentFeedback(
      limitReached
        ? "Two documents are already selected. Remove a file before adding another."
        : `${selectedDocumentFiles.length} of 2 documents selected.`
    );
  });
}

if (documentButton) {
  documentButton.addEventListener("click", async (event) => {
    event.preventDefault();

    if (documentButton.disabled) return;

    const textMode = documentMode.getMode() === "text";

    let textA = "";
    let textB = "";
    let filenameA = "Document A (pasted text)";
    let filenameB = "Document B (pasted text)";

    if (textMode) {
      textA = documentTextA?.value ?? "";
      textB = documentTextB?.value ?? "";

      if (!textA.trim() || !textB.trim()) {
        updateDocumentFeedback(
          "Please paste content into both Document A and Document B."
        );
        return;
      }

      if (
        textA.length > MAX_TEXT_LENGTH ||
        textB.length > MAX_TEXT_LENGTH
      ) {
        updateDocumentFeedback(
          "Each document can contain a maximum of 200,000 characters."
        );
        return;
      }
    } else {
      if (selectedDocumentFiles.length !== 2) {
        updateDocumentFeedback(
          `Please add exactly two documents. Currently selected: ${selectedDocumentFiles.length}.`
        );
        return;
      }

      const oversized = selectedDocumentFiles.find(
        (file) => file.size > MAX_FILE_SIZE
      );

      if (oversized) {
        updateDocumentFeedback(
          `${oversized.name} exceeds the 10 MB file limit.`
        );
        return;
      }

      filenameA = selectedDocumentFiles[0].name;
      filenameB = selectedDocumentFiles[1].name;
    }

    if (documentResults) documentResults.hidden = true;
    documentButton.disabled = true;

    updateDocumentFeedback(
      textMode
        ? "Comparing the pasted documents..."
        : "Extracting both documents and comparing their text..."
    );

    try {
      if (!textMode) {
        const extractedTexts = [];

        for (const file of selectedDocumentFiles) {
          const formData = new FormData();
          formData.append("file", file);

          const response = await fetch(
            `${API_BASE}/api/documents/extract`,
            {
              method: "POST",
              body: formData
            }
          );

          const data = await readJsonResponse(
            response,
            `Could not read ${file.name}.`
          );

          if (typeof data.text !== "string") {
            throw new Error(
              `The backend did not return extracted text for ${file.name}.`
            );
          }

          if (data.text.length > MAX_TEXT_LENGTH) {
            throw new Error(
              `${file.name} contains more than 200,000 characters.`
            );
          }

          extractedTexts.push(data.text);
        }

        textA = extractedTexts[0];
        textB = extractedTexts[1];
      }

      const comparison = await postJson(
        `${API_BASE}/api/compare`,
        {
          text_a: textA,
          text_b: textB
        },
        "Document comparison failed."
      );

      renderComparisonResults({
        results: documentResults,
        scoreElement: document.getElementById("documentScore"),
        methodElement: document.getElementById("documentMethod"),
        matchCountElement: document.getElementById("documentMatchCount"),
        matchList: document.getElementById("documentMatches"),
        prefix: "document",
        unitLabel: "words",
        isCode: false,
        filenameA,
        filenameB
      }, comparison);

      updateDocumentFeedback(
        "Comparison completed. Similarity is not proof of plagiarism."
      );
    } catch (error) {
      console.error("TRACE: Document comparison failed:", error);

      updateDocumentFeedback(
        `Comparison failed: ${error.message}. Check that the backend is running at ${API_BASE}.`
      );
    } finally {
      documentButton.disabled = false;
    }
  });
}

/* ============================================================
   CODE COMPARISON: UPLOAD OR PASTE
   ============================================================ */

const codeInput = document.getElementById("codeFiles");
const codeButton = document.getElementById("codePrepare");
const codeFeedback = document.getElementById("codeFeedback");
const selectedCodeNames = document.getElementById("selectedCodeNames");
const codeResults = document.getElementById("codeResults");

const codeTextA = document.getElementById("codeTextA");
const codeTextB = document.getElementById("codeTextB");

const selectedCodeFiles = [];

const codeMode = configureInputMode({
  uploadButtonId: "codeUploadMode",
  textButtonId: "codeTextMode",
  uploadPanelId: "codeUploadPanel",
  textPanelId: "codeTextPanel",
  resultsId: "codeResults",
  feedbackElement: codeFeedback,
  initialMessage: "Select two code files to begin."
});

function updateCodeFeedback(message = "") {
  showFeedback(
    codeFeedback,
    message || `${selectedCodeFiles.length} of 2 code files selected.`
  );
}

function updateCodeFileList() {
  renderSelectedFiles({
    selectedFiles: selectedCodeFiles,
    container: selectedCodeNames,
    results: codeResults,
    updateFeedback: updateCodeFeedback,
    label: "code file"
  });
}

if (codeInput) {
  codeInput.addEventListener("change", () => {
    const incoming = Array.from(codeInput.files || []);
    const limitReached = addFilesToSelection(
      incoming,
      selectedCodeFiles
    );

    codeInput.value = "";

    if (codeResults) codeResults.hidden = true;

    updateCodeFileList();

    updateCodeFeedback(
      limitReached
        ? "Two code files are already selected. Remove one before adding another."
        : `${selectedCodeFiles.length} of 2 code files selected.`
    );
  });
}

if (codeButton) {
  codeButton.addEventListener("click", async (event) => {
    event.preventDefault();

    if (codeButton.disabled) return;

    const textMode = codeMode.getMode() === "text";

    let codeA = "";
    let codeB = "";
    let filenameA = "Code A (pasted text)";
    let filenameB = "Code B (pasted text)";

    if (textMode) {
      codeA = codeTextA?.value ?? "";
      codeB = codeTextB?.value ?? "";

      if (!codeA.trim() || !codeB.trim()) {
        updateCodeFeedback(
          "Please paste code into both Code A and Code B."
        );
        return;
      }

      if (
        codeA.length > MAX_TEXT_LENGTH ||
        codeB.length > MAX_TEXT_LENGTH
      ) {
        updateCodeFeedback(
          "Each code input can contain a maximum of 200,000 characters."
        );
        return;
      }
    } else {
      if (selectedCodeFiles.length !== 2) {
        updateCodeFeedback(
          `Please select exactly two code files. Currently selected: ${selectedCodeFiles.length}.`
        );
        return;
      }

      const oversized = selectedCodeFiles.find(
        (file) => file.size > MAX_FILE_SIZE
      );

      if (oversized) {
        updateCodeFeedback(
          `${oversized.name} exceeds the 10 MB file limit.`
        );
        return;
      }

      filenameA = selectedCodeFiles[0].name;
      filenameB = selectedCodeFiles[1].name;
    }

    if (codeResults) codeResults.hidden = true;
    codeButton.disabled = true;

    updateCodeFeedback(
      textMode
        ? "Comparing the pasted code..."
        : "Reading both code files and comparing their tokens..."
    );

    try {
      if (!textMode) {
        const codeTexts = await Promise.all(
          selectedCodeFiles.map((file) => file.text())
        );

        codeA = codeTexts[0];
        codeB = codeTexts[1];

        if (!codeA.trim() || !codeB.trim()) {
          throw new Error("One or both code files are empty.");
        }

        if (
          codeA.length > MAX_TEXT_LENGTH ||
          codeB.length > MAX_TEXT_LENGTH
        ) {
          throw new Error(
            "A code file contains more than 200,000 characters. Please use smaller files."
          );
        }
      }

      const comparison = await postJson(
        `${API_BASE}/api/code/compare`,
        {
          filename_a: filenameA,
          filename_b: filenameB,
          code_a: codeA,
          code_b: codeB
        },
        "Code comparison failed."
      );

      console.log("TRACE: Code comparison API response:", comparison);

      renderComparisonResults({
        results: codeResults,
        scoreElement: document.getElementById("codeScore"),
        methodElement: document.getElementById("codeMethod"),
        matchCountElement: document.getElementById("codeMatchCount"),
        matchList: document.getElementById("codeMatches"),
        prefix: "code",
        unitLabel: "tokens",
        isCode: true,
        filenameA,
        filenameB
      }, comparison);

      updateCodeFeedback(
        "Code comparison completed. Similarity is not proof of plagiarism."
      );
    } catch (error) {
      console.error("TRACE: Code comparison failed:", error);

      updateCodeFeedback(
        `Comparison failed: ${error.message}. Check that the backend is running at ${API_BASE} and that the /api/code/compare endpoint is available.`
      );
    } finally {
      codeButton.disabled = false;
    }
  });
}

/* ============================================================
   END OF TRACE SCRIPT
   ============================================================ */
