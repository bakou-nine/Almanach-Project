# Almanach — AI News Sources (curation)

Companion to `almanach_seed.yaml`. Explains the taxonomy, the per-source ratings,
and what has to change in the app to consume this. Curated 2026-05-25; sources
verified active.

## Ratings

- **reliability** — how established / trustworthy the source is (high / medium / low).
- **impact** — how unique/strong its news is and how well it serves *your* purpose:
  AI for tech- and banking-adjacent work, with a deep lean into hardware, local
  deployment, and embodied machines (high / medium / low).

Reliability is a property of the outlet; impact is a personal priority weight, so a
community source like r/LocalLLaMA can be `medium` reliability but `high` impact.

## Structure

Two top folders (tracks), ten category folders nested under them (depth 2). Each
source sits in exactly one folder — the data model gives a source a single
`folder_id`, so no source is duplicated across categories.

---

## Specialized

### Frontier models & methods
| Source | Rel. | Imp. | Why |
| :-- | :-- | :-- | :-- |
| Hugging Face blog | high | high | Open-model launches + practical method writeups, first-party. |
| Import AI (Jack Clark) | high | high | Anthropic co-founder; sharp weekly research + policy synthesis. |
| The Batch (Andrew Ng) | high | medium | Reliable weekly research roundup, lightly editorialized. |
| Ahead of AI (S. Raschka) | high | medium | Deep LLM-architecture explainers. |
| arXiv cs.LG (recent) | high | medium | Primary firehose; high signal but needs filtering. |

### Compute & hardware
| Source | Rel. | Imp. | Why |
| :-- | :-- | :-- | :-- |
| SemiAnalysis | high | high | The reference for AI silicon, datacenter & supply-chain economics. |
| The Next Platform | high | medium | Deep enterprise compute / HPC / accelerator coverage. |
| ServeTheHome | high | medium | Hands-on server, GPU and homelab hardware detail. |
| IEEE Spectrum — Semiconductors | high | medium | Authoritative, engineering-grade chip coverage. |
| Tom's Hardware | medium | low | Broad consumer hardware; useful but noisier. |

### Build-your-own AI — self-hosted & local
| Source | Rel. | Imp. | Why |
| :-- | :-- | :-- | :-- |
| r/LocalLLaMA | medium | high | The pulse of local LLM rigs & deployment; community, so verify. |
| Simon Willison's Weblog | high | high | Best practical writing on running/using models yourself. |
| Ollama blog | medium | medium | First-party local-runtime releases. |
| LM Studio blog | medium | medium | First-party local desktop runtime updates. |
| llama.cpp releases | high | medium | Canonical local-inference engine; release notes track the frontier. |

### Embodied AI & intelligent machines
| Source | Rel. | Imp. | Why |
| :-- | :-- | :-- | :-- |
| IEEE Spectrum — Robotics | high | high | Authoritative robotics + on-device intelligence coverage. |
| The Robot Report | high | medium | Industry news on robots, drones, automation. |
| DroneDJ | medium | medium | Drone-specific; consumer/industry mix. |

### Enterprise & IT AI
| Source | Rel. | Imp. | Why |
| :-- | :-- | :-- | :-- |
| InfoQ — AI/ML/Data | high | medium | Practitioner-grade enterprise AI engineering. |
| VentureBeat AI | medium | medium | Broad enterprise-AI news; mixed depth. |
| The Register — AI/ML | medium | medium | Skeptical, IT-ops angle; good BS filter. |
| The New Stack | medium | low | Cloud-native / devtooling adjacent. |

### AI in banking & finance
| Source | Rel. | Imp. | Why |
| :-- | :-- | :-- | :-- |
| American Banker | high | high | Dedicated AI-in-banking reporting + research. |
| Finextra — AI channel | medium | high | Fintech/banking AI news flow; trade press. |
| The Banker | high | medium | Establishment banking coverage. |
| BIS | high | medium | Central-bank research & regulatory signal. |

---

## General

### Model & product releases
| Source | Rel. | Imp. | Why |
| :-- | :-- | :-- | :-- |
| Anthropic — News | high | high | First-party model/product launches. |
| OpenAI — News | high | high | First-party model/product launches. |
| Google DeepMind — Blog | high | high | First-party research & releases. |
| Meta AI — Blog | high | medium | First-party open-weight releases. |
| Artificial Analysis | medium | high | Independent model benchmarks/leaderboards. |

### Tools, interfaces & orchestration
| Source | Rel. | Imp. | Why |
| :-- | :-- | :-- | :-- |
| Latent Space | medium | high | AI-engineering depth; agents, tooling, interviews. |
| LangChain — Blog | medium | medium | Orchestration framework first-party. |
| LlamaIndex — Blog | medium | medium | RAG/data-framework first-party. |
| Model Context Protocol | high | medium | The interop standard for tools/agents. |

### Business & strategy
| Source | Rel. | Imp. | Why |
| :-- | :-- | :-- | :-- |
| The Information | high | high | Best-sourced tech business scoops (paywall). |
| Stratechery | high | medium | Strategy analysis of platform/AI moves. |
| TechCrunch — AI | medium | medium | Funding, launches, startup flow. |
| TLDR AI | medium | medium | Fast daily aggregator; breadth over depth. |

### Policy, regulation & safety
| Source | Rel. | Imp. | Why |
| :-- | :-- | :-- | :-- |
| MIT Technology Review — AI | high | medium | Rigorous AI + policy journalism. |
| Stanford HAI | high | medium | Academic policy/research center. |
| OECD.AI | high | medium | Cross-jurisdiction AI policy observatory. |
| Alignment Forum | medium | low | Technical safety discussion; community. |

---

## What the app needs to consume this (future, not built)

1. **Schema CR** — add `reliability` and `impact` columns to `Source`
   (DATA_MODEL.md §1.1), additive migration in the `db.py` pattern. Until then the
   two fields here are inert.
2. **Folder-aware first-run seed** — extend `_seed_if_empty` to read this file,
   upsert the folder tree, and set each source's `folder_id`. Today's seed is a
   flat URL list with no folders.
3. **Manual YAML export** — new action that walks folders + sources (+ mute,
   + ratings once they exist) back into this same shape, so import/export
   round-trip. No export exists today.

Each is a separate, explicitly-authorized build (CR/stories) — none done here.

## Notes / decisions

- A standalone "Agentic / computer-operating AI" folder was dropped; agent and
  orchestration coverage lives under **Tools, interfaces & orchestration**. Say the
  word to split it back out.
- Sources are homepage URLs only; the app derives feed URLs at load. A handful
  (arXiv listing page, MCP docs, some channel pages) may not expose a standard
  feed — the seed tolerates discovery failures and simply skips them.
