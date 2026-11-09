# Teacher-output terms — extended findings

Verified 2026-11-08/09 against the providers' published terms and
Microsoft's flow-through language. This document exists because the
corpus plan carried an open check — "Azure OpenAI terms on training
downstream models from GPT outputs — verify before any commercial
use of the synthetic data" — and the check came back **real**.

**Bottom line:** both of this corpus's teachers prohibit using their
outputs to develop competing AI models. That gates *commercially
shipping a checkpoint trained on their outputs*. It does not gate
owning the outputs, selling products that use outputs, or running
Stage 4 as research. Daniel's commercial-first ruling (2026-11-08)
makes this a shipping decision, recorded here in full so it is never
re-derived from memory.

## 1. OpenAI — GPT-6 Astra (via Azure) and GPT-5.5 (pilot)

**OpenAI Services Agreement §3.3(e)** (API/business terms, version
effective 2026-01-01), under "Restrictions":

> "Customer will not, and will not permit End Users to: …
> (e) except for a Permitted Exception, use Output to develop
> artificial intelligence models that compete with OpenAI's products
> and services."

**Permitted Exceptions** are narrow: models primarily intended to
categorize/classify/organize data, and fine-tuning OpenAI's *own*
models through OpenAI's services. A standalone MADLAD fine-tune is
neither.

**Consumer Terms of Use** carry the same line in one sentence:
"Use Output to develop models that compete with OpenAI" is listed
under "What you cannot do."

**Ownership is separate, and it is ours:** §4.1 assigns the customer
all of OpenAI's right, title and interest in the Output. The
translations are owned by Daniel; §3.3(e) restricts one *use* of
them. Owning ≠ free to distill — that split is deliberate drafting.

**Azure flow-through:** Astra was consumed via Azure OpenAI, i.e.
under Microsoft's terms, not a direct OpenAI contract. Microsoft's
Azure OpenAI terms/Code of Conduct flow the same restriction down —
the language as it appears in Microsoft-channel agreements:

> "use output from the OpenAI Models via the Azure Model Service to
> develop any artificial intelligence models that compete with
> OpenAI's products and services" — prohibited.

So the Azure route changes the counterparty, not the substance.
(The October bulk run was paid from an Azure trial credit; a free
credit does not suspend the product terms.)

**Corpus exposure:** all Astra records — ~49,363 Yorùbá + ~103,613
Naija in train, plus pilot Astra Yorùbá records — and the GPT-5.5
pilot records (4,000-record lineage; held out, never trained on, so
pilot exposure matters only if the held-out set is ever repurposed).

## 2. Anthropic — Claude records

**Commercial Terms of Service §D.4** (Use Restrictions), verbatim:

> "Customer may not and must not attempt to (a) access the Services
> to build a competing product or service, including to train
> competing AI models or resell the Services except as expressly
> approved by Anthropic; (b) reverse engineer or duplicate the
> Services…"

**Usage Policy** ("Do Not Abuse" section) is blunter and names the
exact technique:

> "Utilization of inputs and outputs to train an AI model (e.g.,
> 'model scraping' or 'model distillation') without prior
> authorization from Anthropic" — prohibited.

**Consumer Terms §3** likewise prohibit using the services "to
develop any products or services that compete with our Services,
including to develop or train any artificial intelligence or machine
learning algorithms or models."

Anthropic, like OpenAI, assigns the customer ownership of Outputs.
Same split: ownership yes, competing-model training no — absent
**express prior written approval**, which both providers contemplate
as the legitimate route.

**This is enforced, not decorative:** in August 2025 Anthropic
revoked OpenAI's own Claude API access citing this clause family.
Whatever one thinks of the odds at our scale, the clause has been
used against the largest actor in the industry.

**Corpus exposure:** all Claude records — ~49,369 Yorùbá + ~103,636
Naija in train, plus pilot Muse records. **The Claude half is not
a loophole around the Astra half; the restriction is symmetric.**

## 3. What "compete" means for a niche translator — the honest grey

- The providers' own help materials frame the target as models
  competitive with theirs — general-purpose chatbots and open-ended
  generation are the named examples; fine-tuning *through the
  provider's own fine-tuning service* is carved out by both.
- GPT and Claude both translate Yorùbá and Naija today (imperfectly —
  that imperfection is this project's reason to exist). A specialized
  EN→yo/pcm model therefore overlaps a capability they sell, under a
  clause with **no settled narrow reading**. "Niche" is an argument,
  not a safe harbour.
- Nothing in either provider's terms restricts: using outputs in a
  product (the live pigin site does this today), publishing or
  selling the output text itself, evaluating against outputs, or
  training for research. The fence is around **developing a competing
  model** — which a commercial own-model release would be.

## 4. Postures (Daniel's call; gates shipping, not Stage 4)

| Posture | What it means | Cost |
|---|---|---|
| **A. Accept and ship** | Train on the full corpus, ship commercially, carry the contract risk | Enforcement odds low at this scale, but the risk is real, uninsurable, and attaches to A&O Enterprises as the shipper |
| **B. Ask permission** | Written request to OpenAI/Microsoft and Anthropic for authorization (both terms contemplate express approval) | Time; a "no" makes posture A knowingly worse |
| **C. Clean-title commercial checkpoint** | Commercial model trained only on unrestricted data: Tatoeba-derived pairs are still teacher *outputs* — so truly clean means human/Folasade-verified data, MENYO excluded (NC), plus any future open-weights-teacher data whose licence permits distillation | Much smaller/slower data engine today; the synthetic corpus remains the research line |
| **D. Re-teacher later** | Regenerate the corpus with an open-weights teacher under a licence that permits training on outputs (e.g. an Apache-2.0 model self-hosted), keeping the dual-teacher quality gate | A second bulk run's cost; Yorùbá quality of open teachers is the open question |

The assembler already tags every record with its teacher, so A/C/D
are mechanical filters, not rebuilds. Stage 4 (research run, $200
cap, de-risk ladder in `HARDWARE-AND-H100-DECISION.md`) proceeds
under any posture; the choice binds at Stage 5/6, when a checkpoint
would ship.

## Sources (checked 2026-11-08/09)

- OpenAI Services Agreement (eff. 2026-01-01), §§3.3(e), 4.1 —
  via the OpenAI terms text and the Terms Observatory mirror.
- OpenAI Terms of Use (consumer), "What you cannot do."
- Microsoft Azure OpenAI flow-through language, as reproduced in
  Microsoft-channel agreements (e.g. Palantir AIP Addendum, Azure
  Model Service additional terms); Microsoft AI Services Code of
  Conduct, Microsoft Learn.
- Anthropic Commercial Terms of Service §D.4; Anthropic Usage
  Policy ("Do Not Abuse"); Anthropic Consumer Terms §3; Anthropic
  help-center summary ("Our Terms do not allow the use of Outputs to
  train models that are competitive with Anthropic's own").
- Cross-provider analysis: infro.io, "Can you train on AI outputs?
  What provider terms say" (Oct 2026 crawl).

*This is a faithful record of published terms for a build decision,
not legal advice. If the commercial checkpoint ever matters enough,
posture B or a lawyer is the grown-up route — and Butch is a lawyer
Daniel already knows.*
