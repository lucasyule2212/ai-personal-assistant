# 🤖 AI Personal Assistant

> Building a production-ready AI personal assistant with retrieval, memory, evals, and human-in-the-loop patterns in TypeScript.

## 📖 Overview

This repository contains my coursework from the **Build a Personal Assistant in TypeScript** cohort by AI Hero. It includes both skill-building exercises and the main project implementation.

## 📂 Repository Structure

### [`/skill-building`](./skill-building)

The exercises repository covering foundational concepts through hands-on practice:

- **📅 Days 1-2: Retrieval** - BM25 keyword search, embeddings, rank fusion, query rewriting, chunking, reranking, and agentic search patterns
- **🧠 Day 3: Memory** - Semantic and episodic memory systems, working memory for infinite conversations
- **🧪 Day 4: Evals** - Testing with Evalite, deterministic scorers, LLM-as-judge patterns
- **👤 Day 5: Human-in-the-Loop** - Approval flows, thread-scoped permissions, MCP integrations

Each exercise includes `problem/`, `solution/`, and `explainer/` folders for structured learning.

### [`/project`](./project)

The main project workspace where techniques from exercises are implemented into a functional AI assistant:

- **🔍 Hybrid Retrieval:** BM25 + semantic embeddings + rank fusion to search 547 emails
- **💾 Memory System:** Semantic recall, working memory, and episodic learning
- **🛠️ Agentic Tools:** Metadata-first retrieval patterns
- **📊 Evaluation Framework:** Tool call testing and LLM-as-judge scorers
- **✅ Human-in-the-Loop:** Approval system for destructive actions
- **🔌 MCP Integration:** External tool access

## 🛠️ Tech Stack

- **Framework:** [Next.js 15](https://nextjs.org/) (App Router) / Vite + Hono
- **Language:** TypeScript
- **AI SDK:** [Vercel AI SDK v5](https://sdk.vercel.ai/)
- **Models:** [Google Gemini](https://ai.google.dev/), Claude, GPT-4
- **Retrieval:** BM25 (okapibm25), embeddings, semantic search
- **Testing:** [Evalite](https://www.evalite.dev/)
- **UI:** React 19, Radix UI, Tailwind CSS

## 🚀 Getting Started

### Prerequisites

- Node.js 22+
- pnpm (`npm install -g pnpm`)
- API keys for AI providers (Google/Anthropic/OpenAI)

### Setup

1. Install dependencies in each folder:

```bash
cd skill-building && pnpm install
cd ../project && pnpm install
```

2. Configure environment variables in each folder (copy `.env.example` to `.env` and add your API keys)

3. Run exercises or project:

```bash
# Skill-building exercises
cd skill-building && pnpm dev

# Project
cd project && pnpm dev
```

## 🙏 Acknowledgements

This project is based on the **"Build a Personal Assistant in TypeScript"** 5-day cohort course by AI Hero.

[AI Hero - Build Your Own AI Personal Assistant](https://www.aihero.dev/cohorts/build-your-own-ai-personal-assistant-in-typescript)
