# Hardware assessment — do we really need to rent an H100?

Written 2026-11-08 so this question never has to be re-litigated from
memory. Short answer: **yes, for the keeper full fine-tune — and the
spend is structured so we know it works before the money is committed.**
Daniel's position, recorded the same day: *willing to spend the $200
if we KNOW it will work.* The de-risk ladder at the bottom is how
"know" is achieved.

## fola4 (Fola4.0) — verified by live SSH probes, 2026-11-08

Daniel's account of his own machine was right in substance at every
step of a three-round correction (an early survey's "no GPU, 22 GB"
shorthand was wrong twice over):

- **CPU/GPU:** AMD Ryzen 7 8845HS with **integrated Radeon 780M**
  (RDNA3, gfx1103). No NVIDIA/discrete card; `nvidia-smi` absent.
- **RAM: 32 GB physical** (dmidecode: 2 × 16 GB DIMMs).
- **Dedicated VRAM carve: exactly 8 GiB** — amdgpu
  `mem_info_vram_total` = 8,589,934,592 bytes, reserved UMA-style
  before the OS boots. This is why Linux reports only
  MemTotal ≈ 22.8 GiB: the OS sees what the GPU didn't take.
- **Shared aperture (GTT): ~11.4 GiB at current settings, scalable to
  roughly half of system RAM (16+ GB).** On an APU the spill into GTT
  runs at full memory bandwidth — there is no PCIe cliff like a
  discrete card exhausting its VRAM.

### The production proof (Daniel's, not theoretical)

`~/nsfw-pr/scripts/batch_krea2_gguf.py` on fola4 runs **Krea-2-Turbo
(a 12B-class model) as a Q4 GGUF through ROCm PyTorch / ComfyUI on the
780M**, at high resolution, logging its own peak VRAM, with output
folders banked (`~/Desktop/vscode/nsfw-production/outputs`, krea
series). A 12B image model with its text encoder, VAE and high-res
activations does not fit an 8 GiB carve — it lives in the shared pool.
Conclusion: **fola4 is a genuinely capable GGUF inference box**, and a
plausible second serving seat for Stage 6 (7B-class GGUF translation
inference fits its GPU-addressable memory comfortably).

### What fola4 still cannot do, and why

- **7B full fine-tune: impossible here, and not a VRAM-aperture
  question.** Full FT working footprint (bf16 weights ~14 GB +
  gradients ~14 GB + optimizer states ~56 GB at fp32 Adam moments,
  before activations) is on the order of **~100 GB — more than the
  machine's 32 GB of physical RAM in total**, however the GPU/CPU
  split is arranged.
- **QLoRA via bitsandbytes: poor fit.** bnb's ROCm support is the weak
  link, and gfx1103 is unofficial ROCm territory (override flags).
- **A 3B LoRA experiment: conceivable** (~20 GB GPU-addressable, fp16
  + a light optimizer) — a slow research detour on unofficial ROCm,
  not a validation of the keeper configuration.

## fola4-1 — RTX 4060, 8,188 MiB, 60 GB RAM (verified 2026-11-08)

- **7B anything-training: no.** bf16 weights alone (~14.4 GB) exceed
  the card.
- **3B + LoRA pipeline smoke: yes.** Validates data → format → loss
  moves → save/load, end to end, free. (Card is shared with the MVT
  Fredericton work; needs a free window.)
- Its Stage 6 role (serving the quantized keeper) is unaffected.

## This VM / any CPU seat

Tokenizer and data-pipeline checks only. Already productive: the
**`<2pcm>` catch** (MADLAD-400 has no Nigerian Pidgin tag) was made by
inspecting the model's tokenizer vocabulary on CPU, before any rental.

## The H100 decision

**Rent it.** The keeper — a full fine-tune of a 7.2B T5 on 306k pairs,
with a preference pass and reranking behind it — fits no machine we
own, and no amount of shared-memory ingenuity changes the ~100 GB
arithmetic. The H100's 80 GB is not a luxury; with 8-bit optimizer
states and gradient checkpointing (see `stage4_config.json`) it is
approximately the *minimum* honest seat for the job as designed.

### The de-risk ladder — how we KNOW before the $200 is at stake

Daniel's condition was knowledge, not hope. The spend is sequenced so
each rung is proven before the next is paid for:

1. **Tokenizer facts — DONE, free** (2026-11-08): `<2yo>` native,
   `<2pcm>` added-token strategy in the training script.
2. **Pipeline smoke on the 4060 — free, pending a card window:** the
   3B LoRA run exercises the exact scripts' data path on real data.
3. **Pod smoke — the first paid minutes only:** `stage4_train.py
   --smoke` + base-model eval on the actual H100, actual config.
   Estimated cost of this rung: single-digit dollars. If it fails,
   we stop, and the $200 was never spent — only the smoke was.
4. **Keeper run** starts only with rung 3 green, under the config's
   $200 hard cap with RunPod billing alerts set (runbook pre-flight).

What could still surprise us at rung 3/4, stated plainly: throughput
slower than the 6–11 h estimate (costs time, capped money), a CUDA
environment behaving differently than local rehearsal (that is what
the smoke is *for*), and the teacher-output terms below. None of
these is a reason to train the keeper on the wrong hardware; all of
them are reasons the ladder exists.

## Teacher-output terms — the "GPT training" gate, verified 2026-11-08

The corpus plan's open check ("Azure OpenAI terms on training
downstream models from GPT outputs") is a real clause, not boilerplate
anxiety:

- **OpenAI Services Agreement §3.3(e)** (the API/business terms;
  Azure OpenAI usage sits under Microsoft's equivalent framework):
  the customer will not "use Output to develop artificial
  intelligence models that compete with OpenAI's products and
  services," except for Permitted Exceptions (internal
  classifiers/embeddings; fine-tuning OpenAI's own models). The
  consumer Terms of Use carry the same line in shorter form.
- **Anthropic's terms carry an analogous restriction** on using
  outputs to train competing models / build competing services
  without authorization. **Both of this corpus's teachers are
  therefore restricted the same way** — the Claude half is not a
  loophole around the Astra half.
- What the clause does **not** restrict: owning the outputs (they are
  assigned to the customer), selling products that *use* outputs, or
  running the training itself as research. The restriction bites on
  **developing a competing model** — which is precisely what a
  commercial EN→Yorùbá/Naija model arguably is, since GPT itself
  translates these languages. "Competes" has no settled narrow
  reading; a niche translator is the grey zone, not a clear pass.
- Postures available, in the repo's commercial-first frame: (a) train
  and accept the contract risk with eyes open — industry-common, but
  it is a risk, and it attaches to the *checkpoint's* commercial use,
  not to the run; (b) seek permission / enterprise terms; (c) keep
  the synthetic corpus for research checkpoints and build the
  *commercial* checkpoint only from unrestricted data (the assembler
  tags every record's teacher, so the split is mechanical); (d) one
  day, re-teacher with an open-weights model whose licence permits
  it. This is Daniel's call, and it gates shipping, not Stage 4.
