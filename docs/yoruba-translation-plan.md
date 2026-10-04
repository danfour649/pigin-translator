# Plan: improving the English-to-Yorùbá generator

This is a plan. The fine-tune below is still undone. No corpus has been downloaded into this repository, no verse or training sentence is stored here, and training has not started. The app, prompts, model list, and Speak route are unchanged.

## What open bitext leaves unfixed

Open English–Yorùbá bitext is mostly news, talks, and religion. It will not by itself fix everyday mistakes already seen:

- kinship (husband versus farmer)
- slang such as vaping
- dropped or wrong tone marks
- turning a statement into a question (`Kí ni` means "what")

## Sources and license limits

### MENYO-20k

[MENYO-20k](https://github.com/uds-lsv/menyo-20k_MT), described in [the paper](https://arxiv.org/pdf/2103.08647), has about 20,100 English–Yorùbá sentences from news, TED, movies, radio, and science. The repository `LICENSE` file is Creative Commons Attribution-NonCommercial 4.0 International, and the paper states the same CC BY-NC 4.0 licence. The repository README limits use to non-commercial because some sources, including TED and JW news, need permission for commercial use.

Reported splits: 10,070 train, 3,397 dev, 6,633 test. The test split is for scoring, not training.

### Bible editions named in that paper

The same paper aligned the New International Version in English with the Bible Society of Nigeria Yorùbá edition, about 30,760 verses. Those editions are copyrighted. Do not scrape or redistribute them.

A public-domain or explicitly open Bible edition could be a seed for formal language only, and only after its license is checked. This plan does not name one; whether any candidate is public-domain or explicitly open is unclear until that check. Do not scrape a modern Bible site.

### JW300

[Meta's NLLB data notes](https://github.com/facebookresearch/fairseq/blob/nllb/examples/nllb/data/README.md) say JW300 was no longer publicly available for MT training at publication because of licensing issues with Jehovah's Witnesses. Do not scrape jw.org and do not use JW300.

### NLLB mined bitext and model weights

[AllenAI's hosted NLLB mined bitext](https://huggingface.co/datasets/allenai/nllb) is ODC-BY, and use is also bound by each original source's terms.

NLLB model weights are CC-BY-NC 4.0 ([fairseq NLLB README](https://github.com/facebookresearch/fairseq/blob/nllb/README.md)). The same README licenses the NLLB code as MIT. The non-commercial limit here is the weights.

### A dataset card is not permission for the texts

A Hugging Face card that stamps CC-BY 4.0 on an OPUS extract, such as [`michsethowusu/english-yoruba_sentence-pairs_mt560`](https://huggingface.co/datasets/michsethowusu/english-yoruba_sentence-pairs_mt560), does not clear the underlying texts. That card states Creative Commons Attribution 4.0 International and points readers to the OPUS MT560 citation guide. The licenses of the underlying texts are not stated on the card, so they are unclear. Do not treat that card as permission.

## The training set that is still missing

The useful training set is everyday English–Yorùbá pairs the user's wife accepts. Saved corrections are the start and are not enough. Hundreds are needed. Do not paste those pairs into the GPT prompt.

## Fine-tune work that is still undone

Do not train a general LLM from scratch. The work is to fine-tune a translation model in the NLLB class, on a GPU host, not inside a Vercel route.

Hold out a test set she grades. Do not train on MENYO's test split or on FLORES.

Before any download, check whether the public site can use a CC-BY-NC resource. MENYO text and NLLB weights are non-commercial. That check is not done.
