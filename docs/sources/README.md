# Source library

Every research source the app's rules rest on: the citations in `src/` comments and in the learning-item research behind them (items 00–16). For each one this file gives:
- the full citation and DOI;
- whether it is free to read;
- one line, in our own words, on what it found;
- which app files and rules use it.

Built 2026-10-20. Access status comes from OpenAlex, Europe PMC and Crossref as of that date.

**Conventions**
- **Evidence labels** match the code comments:
  - (a): a cited study;
  - (b): learned from the lifter's own log;
  - (c): a neutral default that never triggers an action.
- **Used by** names source files under `src/domain/` (or `worker/src/`). "Item NN" is the learning item of that number, as named in the code comments.
- **Access** shows how a source can be read:

  | Label | Meaning |
  |---|---|
  | open access (journal / hybrid) | Free from the publisher under an open licence |
  | free copy in a repository | A legal author or institutional copy exists |
  | free to read at the publisher | Free on the publisher's site, but with no open licence |
  | paywalled | No free copy was found |

- **Local PDF** says whether a copy is kept in the maintainer's private, git-ignored folder (`.superpowers/sources/pdf/`).
  - Copyrighted PDFs are never committed to this public repository.
  - Only open-access files are kept there.
- **Summaries** are paraphrases, not quotations.

**Most relevant single source.** The ACSM 2026 position stand (first entry below) replaces the 2009 stand. It is open access (CC BY-NC-ND 4.0).

## Position stands

- **Currier 2026 (ACSM).** Currier BS, D'Souza AC, Fiatarone Singh MA, et al. (2026). American College of Sports Medicine Position Stand. Resistance Training Prescription for Muscle Function, Hypertrophy, and Physical Performance in Healthy Adults: An Overview of Reviews. *Medicine & Science in Sports & Exercise* 58(4):851–872. doi:[10.1249/mss.0000000000003897](https://doi.org/10.1249/mss.0000000000003897). **Access:** open access (publisher, hybrid); CC BY-NC-ND 4.0; PMC [PMC12965823](https://pmc.ncbi.nlm.nih.gov/articles/PMC12965823/); press release and lay material: [acsm.org](https://acsm.org/science-spotlight-acsm-releases-new-position-stand-on-resistance-training/). **Local PDF:** yes: `acsm-2026-position-stand/`, `acsm-2026-supplement/`, `acsm-2026-fulltext-txt/`, plus the ACSM infographic and slide deck.
  - *Finding:* ACSM's 2026 overview of 137 systematic reviews: heavier loads, 2–3 sets, full range, early placement and ≥2 days/wk raise strength; ≥10 weekly sets and eccentric overload raise size; failure, periodization and equipment type are optional.
  - *Used by:* This library's ACSM write-up; item 10 (lift order); replaces the 2009 increment rule cited in item 01
- **Ratamess 2009 (ACSM).** Ratamess NA, Alvar BA, Evetoch TK, et al. (2009). Progression Models in Resistance Training for Healthy Adults. *Medicine & Science in Sports & Exercise* 41(3):687–708. doi:[10.1249/mss.0b013e3181915670](https://doi.org/10.1249/mss.0b013e3181915670). **Access:** paywalled. **Local PDF:** no.
  - *Finding:* The previous ACSM stand: expert-graded progression models (8–12RM for novices, periodized 1–12RM for advanced lifters, +2–10% once the target is beaten by 1–2 reps).
  - *Used by:* Item 01 (the +2–10% load rule, now superseded); item 10 (traditional large-before-small order)

## Load, rep ranges and proximity to failure

- **Schoenfeld 2017a.** Schoenfeld BJ, Grgić J, Ogborn DI, et al. (2017). Strength and Hypertrophy Adaptations Between Low- vs. High-Load Resistance Training: A Systematic Review and Meta-analysis. *The Journal of Strength and Conditioning Research* 31(12):3508–3523. doi:[10.1519/jsc.0000000000002200](https://doi.org/10.1519/jsc.0000000000002200). **Access:** paywalled. **Local PDF:** no.
  - *Finding:* Meta-analysis of 21 studies: low and high loads built similar muscle when sets went to failure; heavy loads gave more 1RM strength.
  - *Used by:* `learn/range.ts` (growth equal across loads); items 01, 02, 03, 07, 14
- **Lopez 2021.** López P, Radaelli R, Taaffe DR, et al. (2021). Resistance Training Load Effects on Muscle Hypertrophy and Strength Gain: Systematic Review and Network Meta-analysis. *Medicine & Science in Sports & Exercise* 53(6):1206–1216. doi:[10.1249/mss.0000000000002585](https://doi.org/10.1249/mss.0000000000002585). **Access:** open access (publisher, hybrid); repository copy: [JYX](https://jyx.jyu.fi/handle/123456789/75929). **Local PDF:** no.
  - *Finding:* Network meta-analysis of 28 studies: hypertrophy did not depend on load; strength was better with high or moderate loads than low.
  - *Used by:* `learn/range.ts`; items 01, 03
- **Schoenfeld 2021.** Schoenfeld BJ, Grgić J, van Every DW, et al. (2021). Loading Recommendations for Muscle Strength, Hypertrophy, and Local Endurance: A Re-Examination of the Repetition Continuum. *Sports* 9(2):32. doi:[10.3390/sports9020032](https://doi.org/10.3390/sports9020032). **Access:** open access (OA journal) ([copy](https://www.mdpi.com/2075-4663/9/2/32/pdf?version=1614303575)). **Local PDF:** no.
  - *Finding:* Narrative re-examination of the repetition continuum: heavy loads suit strength, a wide range suits size, light loads suit local endurance.
  - *Used by:* `learn/range.ts` evidence envelope (barbell 5–15 reps); item 03
- **Lasevicius 2018.** Lasevicius T, Ugrinowitsch C, Schoenfeld BJ, et al. (2018). Effects of different intensities of resistance training with equated volume load on muscle strength and hypertrophy. *European Journal of Sport Science* 18(6):772–780. doi:[10.1080/17461391.2018.1450898](https://doi.org/10.1080/17461391.2018.1450898). **Access:** paywalled. **Local PDF:** no.
  - *Finding:* Volume-equated trial: training at 20% of 1RM grew less muscle than 40, 60 or 80%.
  - *Used by:* `learn/range.ts` (the ~30% 1RM floor behind the isolation cap of 25 reps); item 03
- **Lasevicius 2022.** Lasevicius T, Schoenfeld BJ, Silva-Batista C, et al. (2022). Muscle Failure Promotes Greater Muscle Hypertrophy in Low-Load but Not in High-Load Resistance Training. *The Journal of Strength and Conditioning Research* 36(2):346–351. doi:[10.1519/jsc.0000000000003454](https://doi.org/10.1519/jsc.0000000000003454). **Access:** paywalled. **Local PDF:** no.
  - *Finding:* Trial in which taking sets to failure mattered for growth at a low load but not at a high load.
  - *Used by:* Item 03 (why light sets must end near failure)
- **Lees 2025.** Lees MJ, Mcleod JC, Morton RW, et al. (2025). Resistance training load does not determine resistance training‐induced hypertrophy across upper and lower limbs in healthy young males. *The Journal of Physiology*. doi:[10.1113/jp289684](https://doi.org/10.1113/jp289684). **Access:** open access (publisher, hybrid) ([copy](https://onlinelibrary.wiley.com/doi/pdfdirect/10.1113/JP289684)). **Local PDF:** no.
  - *Finding:* Within-person trial in untrained adults: the load used did not decide how much the arms and legs grew.
  - *Used by:* `learn/range.ts`; item 03
- **Cumming 2025.** Cumming KT, Elvatun IC, Kalenius R, et al. (2025). Divergent strength gains but similar hypertrophy after low-load and high-load resistance exercise training in trained individuals: many roads lead to Rome. *Journal of Applied Physiology* 139(3):685–697. doi:[10.1152/japplphysiol.00353.2025](https://doi.org/10.1152/japplphysiol.00353.2025). **Access:** open access (publisher, hybrid). **Local PDF:** no.
  - *Finding:* Within-person trial in trained lifters: heavy and light loads grew muscle alike; single-joint 1RM favoured heavy.
  - *Used by:* `learn/range.ts`; item 03
- **Robinson 2024.** Robinson ZP, Pelland JC, Remmert JF, et al. (2024). Exploring the Dose–Response Relationship Between Estimated Resistance Training Proximity to Failure, Strength Gain, and Muscle Hypertrophy: A Series of Meta-Regressions. *Sports Medicine* 54(9):2209–2231. doi:[10.1007/s40279-024-02069-2](https://doi.org/10.1007/s40279-024-02069-2). **Access:** open access (OA journal). **Local PDF:** no.
  - *Finding:* Meta-regressions: hypertrophy rises as sets end closer to failure; strength changes little with proximity to failure.
  - *Used by:* `learn/capacity.ts` (working sets end 0–3 RIR); items 03, 07
- **Fisher & Steele 2017.** Fisher JP, Steele J (2017). Heavier and lighter load resistance training to momentary failure produce similar increases in strength with differing degrees of discomfort. *Muscle & Nerve* 56(4):797–803. doi:[10.1002/mus.25537](https://doi.org/10.1002/mus.25537). **Access:** paywalled. **Local PDF:** no.
  - *Finding:* Heavy and light training to failure raised strength alike, but light sets felt more uncomfortable.
  - *Used by:* Item 03 (comfort as a reason to keep reps moderate)
- **Stuart 2018.** Stuart CM, Steele J, Gentil P, et al. (2018). Fatigue and perceptual responses of heavier- and lighter-load isolated lumbar extension resistance exercise in males and females. *PeerJ* 6:e4523. doi:[10.7717/peerj.4523](https://doi.org/10.7717/peerj.4523). **Access:** open access (OA journal) ([copy](https://peerj.com/articles/4523.pdf)). **Local PDF:** no.
  - *Finding:* Small study of perceived effort and discomfort across loads taken to failure; supports not pushing reps very high.
  - *Used by:* Item 03 (comfort and effort at high reps)
- **Beyer 2015.** Beyer R, Kongsgaard M, Kjær BH, et al. (2015). Heavy Slow Resistance Versus Eccentric Training as Treatment for Achilles Tendinopathy. *The American Journal of Sports Medicine* 43(7):1704–1711. doi:[10.1177/0363546515584760](https://doi.org/10.1177/0363546515584760). **Access:** paywalled. **Local PDF:** no.
  - *Finding:* Tendon rehab trial: heavy slow resistance (15RM down to 6RM) matched eccentric training for Achilles pain.
  - *Used by:* Item 03 (joint-friendly does not mean light)

## Rating effort (RIR) and its accuracy

- **Halperin 2022.** Halperin I, Malleron T, Har-Nir I, et al. (2022). Accuracy in Predicting Repetitions to Task Failure in Resistance Exercise: A Scoping Review and Exploratory Meta-analysis. *Sports Medicine* 52(2):377–390. doi:[10.1007/s40279-021-01559-x](https://doi.org/10.1007/s40279-021-01559-x). **Access:** free to read at the publisher (no open licence) ([copy](https://link.springer.com/content/pdf/10.1007/s40279-021-01559-x.pdf)); free preprint: [SportRxiv 67](https://sportrxiv.org/index.php/server/preprint/view/67). **Local PDF:** no.
  - *Finding:* Scoping review and meta-analysis: people under-predict reps left, and errors grow with reps and distance from failure.
  - *Used by:* `learn/capacity.ts` (RIR bias), `learn/range.ts` (RIR judgement fails past 12–15 reps); items 02–07
- **Zourdos 2016.** Zourdos MC, Klemp A, Dolan C, et al. (2016). Novel Resistance Training–Specific Rating of Perceived Exertion Scale Measuring Repetitions in Reserve. *The Journal of Strength and Conditioning Research* 30(1):267–275. doi:[10.1519/jsc.0000000000001049](https://doi.org/10.1519/jsc.0000000000001049). **Access:** free copy in a repository ([copy](https://openrepository.aut.ac.nz/bitstreams/16ad9fb9-5da8-446b-9cd9-aae75afb0b92/download)); repository copy: [AUT](https://openrepository.aut.ac.nz/items/efef3b25-6701-4fb5-bb82-55fcd2a26027/full). **Local PDF:** no.
  - *Finding:* Introduced the RIR-based RPE scale and showed it tracks bar speed, more accurately in experienced lifters.
  - *Used by:* The RIR scale the app logs; items 02, 04, 05
- **Helms 2016.** Helms ER, Cronin JB, Storey AG, et al. (2016). Application of the Repetitions in Reserve-Based Rating of Perceived Exertion Scale for Resistance Training. *Strength and conditioning journal* 38(4):42–49. doi:[10.1519/ssc.0000000000000218](https://doi.org/10.1519/ssc.0000000000000218). **Access:** open access (publisher, hybrid); repository copy: [AUT](https://openrepository.aut.ac.nz/items/92cefeac-7c32-44f1-bfbc-f48f4a5dd8cf/full). **Local PDF:** no.
  - *Finding:* Practical guide to prescribing load and effort with the RIR-based RPE scale.
  - *Used by:* Items 02, 04 (how RIR is used to set load)
- **Helms 2017.** Helms ER, Brown SR, Cross MR, et al. (2017). Self-Rated Accuracy of Rating of Perceived Exertion-Based Load Prescription in Powerlifters. *The Journal of Strength and Conditioning Research* 31(10):2938–2943. doi:[10.1519/jsc.0000000000002097](https://doi.org/10.1519/jsc.0000000000002097). **Access:** free copy in a repository ([copy](https://openrepository.aut.ac.nz/bitstreams/7d4bb5ba-879d-4b75-8e62-4e5de5c0d5c8/download)); repository copy: [AUT](https://openrepository.aut.ac.nz/items/9d066ef2-8ebc-490b-af31-31b0fa9aca61/full). **Local PDF:** no.
  - *Finding:* Powerlifters rated effort accurately when prescribing loads by RPE, especially near failure.
  - *Used by:* Item 04
- **Helms 2018.** Helms ER, Byrnes RK, Cooke DM, et al. (2018). RPE vs. Percentage 1RM Loading in Periodized Programs Matched for Sets and Repetitions. *Frontiers in Physiology* 9:247. doi:[10.3389/fphys.2018.00247](https://doi.org/10.3389/fphys.2018.00247). **Access:** open access (OA journal) ([copy](https://www.frontiersin.org/articles/10.3389/fphys.2018.00247/pdf)). **Local PDF:** no.
  - *Finding:* Trial comparing RPE-based and %1RM-based loading with matched sets and reps; RPE loading did at least as well.
  - *Used by:* Items 04, 05 (a stale or one-off 1RM can mislead)
- **Zourdos 2021.** Zourdos MC, Goldsmith JA, Helms ER, et al. (2021). Proximity to Failure and Total Repetitions Performed in a Set Influences Accuracy of Intraset Repetitions in Reserve-Based Rating of Perceived Exertion. *The Journal of Strength and Conditioning Research* 35(1):S158–S165. doi:[10.1519/jsc.0000000000002995](https://doi.org/10.1519/jsc.0000000000002995). **Access:** paywalled. **Local PDF:** no.
  - *Finding:* Squat sets to failure at 70%: RIR predictions were less accurate far from failure and in longer sets.
  - *Used by:* `learn/capacity.ts` (RIR error grows with reps); item 04
- **Refalo 2024a.** Refalo MC, Remmert JF, Pelland JC, et al. (2024). Accuracy of Intraset Repetitions-in-Reserve Predictions During the Bench Press Exercise in Resistance-Trained Male and Female Subjects. *The Journal of Strength and Conditioning Research* 38(3):e78–e85. doi:[10.1519/jsc.0000000000004653](https://doi.org/10.1519/jsc.0000000000004653). **Access:** free copy in a repository ([copy](https://figshare.com/articles/journal_contribution/Accuracy_of_Intraset_Repetitions-in-Reserve_Predictions_During_the_Bench_Press_Exercise_in_Resistance-Trained_Male_and_Female_Subjects/24814266)). **Local PDF:** no.
  - *Finding:* Bench press study in trained men and women: in-set RIR predictions were close on average with about a rep of scatter.
  - *Used by:* `learn/capacity.ts` (trained lifters' RIR error, about −0.2 ± 1 rep); items 04, 05
- **Steele 2017.** Steele J, Endres A, Fisher JP, et al. (2017). Ability to predict repetitions to momentary failure is not perfectly accurate, though improves with resistance training experience. *PeerJ* 5:e4105. doi:[10.7717/peerj.4105](https://doi.org/10.7717/peerj.4105). **Access:** open access (OA journal) ([copy](https://peerj.com/articles/4105.pdf)). **Local PDF:** no.
  - *Finding:* 141 people predicted reps before sets to failure: predictions were off, improving with training experience.
  - *Used by:* `learn/capacity.ts`; item 04
- **Russo 2025.** Russo F, Marconcin P, Gomes DCL, et al. (2025). Factors influencing the accuracy of the repetition in reserve scale in resistance training: a systematic review. *Physical Therapy Reviews* 31(1):46–63. doi:[10.1080/10833196.2025.2564026](https://doi.org/10.1080/10833196.2025.2564026). **Access:** free copy in a repository ([copy](http://hdl.handle.net/10174/39438)); repository record: [Évora](https://dev.rdpc.dspace.uevora.pt/items/d6f78224-a6e5-4f67-b1b8-2c65c7e7f199). **Local PDF:** no.
  - *Finding:* Systematic review of what makes RIR ratings more or less accurate (experience, proximity to failure, reps per set).
  - *Used by:* Item 04
- **Remmert theses (FAU).** Remmert JF. Master's thesis and companion study on RIR prediction accuracy, Florida Atlantic University (FAU Digital Library records 37482 and 69484). [fau.isle.flvc.org](https://fau.isle.flvc.org/node/37482). **Access:** free (thesis record). **Local PDF:** no.
  - *Finding:* Small thesis studies: bench RIR predictions were more accurate near failure, and six weeks of practice did not improve them.
  - *Used by:* Item 05

## Strength estimates (e1RM), testing and detraining

- **Nuzzo 2024.** Nuzzo JL, Pinto MD, Nosaka K, et al. (2024). Maximal Number of Repetitions at Percentages of the One Repetition Maximum: A Meta-Regression and Moderator Analysis of Sex, Age, Training Status, and Exercise. *Sports Medicine* 54(2):303–321. doi:[10.1007/s40279-023-01937-7](https://doi.org/10.1007/s40279-023-01937-7). **Access:** open access (publisher, hybrid) ([copy](https://link.springer.com/content/pdf/10.1007/s40279-023-01937-7.pdf)). **Local PDF:** no.
  - *Finding:* Meta-regression of reps to failure at each %1RM, with between-person spread and moderators such as exercise and training status.
  - *Used by:* `learn/capacity.ts` (reps–load slope spread), `learn/jump.ts` (prior for the drop after a weight step); items 00–04
- **Reynolds 2006.** Reynolds J, Gordon TJ, Robergs RA (2006). PREDICTION OF ONE REPETITION MAXIMUM STRENGTH FROM MULTIPLE REPETITION MAXIMUM TESTING AND ANTHROPOMETRY. *The Journal of Strength and Conditioning Research* 20(3):584. doi:[10.1519/00124278-200608000-00020](https://doi.org/10.1519/00124278-200608000-00020). **Access:** paywalled; author-hosted copy: [UNM](https://www.unm.edu/~rrobergs/478RMStrengthPrediction.pdf). **Local PDF:** no.
  - *Finding:* 1RM prediction equations work best from low-rep sets; accuracy falls as reps rise.
  - *Used by:* `learn/capacity.ts` and `estimators.ts` (no e1RM from sets past 20 reps); items 02, 04, 05, 14
- **Epley 1985.** Epley B. Poundage Chart. Boyd Epley Workout. Lincoln, NE: Body Enterprises; 1985. [en.wikipedia.org](https://en.wikipedia.org/wiki/One-repetition_maximum). **Access:** not a journal article (coaching chart). **Local PDF:** no.
  - *Finding:* The e1RM rule the app uses: 1RM ≈ weight × (1 + reps/30).
  - *Used by:* `estimators.ts`, `learn/capacity.ts`, `learn/strength.ts`, `records.ts`, `rotation.ts`, `learn/jump.ts` (the e1RM formula)
- **Mayhew 2008.** Mayhew JL, Johnson BD, LaMonte MJ, et al. (2008). Accuracy of Prediction Equations for Determining One Repetition Maximum Bench Press in Women Before and After Resistance Training. *The Journal of Strength and Conditioning Research* 22(5):1570–1577. doi:[10.1519/jsc.0b013e31817b02ad](https://doi.org/10.1519/jsc.0b013e31817b02ad). **Access:** paywalled. **Local PDF:** no.
  - *Finding:* Compared 1RM prediction equations against tested maxima; formula error grows with reps.
  - *Used by:* Item 05
- **LeSuer 1997.** LeSuer DA, McCormick JH, Mayhew JL, et al. (1997). The Accuracy of Prediction Equations for Estimating 1-RM Performance in the Bench Press, Squat, and Deadlift. *The Journal of Strength and Conditioning Research* 11(4):211. doi:[10.1519/00124278-199711000-00001](https://doi.org/10.1519/00124278-199711000-00001). **Access:** paywalled. **Local PDF:** no.
  - *Finding:* Seven 1RM equations were accurate on bench but less so on squat and deadlift.
  - *Used by:* Item 02
- **Richens & Cleather 2014.** Richens B, Cleather DJ (2014). THE RELATIONSHIP BETWEEN THE NUMBER OF REPETITIONS PERFORMED AT GIVEN INTENSITIES IS DIFFERENT IN ENDURANCE AND STRENGTH TRAINED ATHLETES. *Biology of Sport* 31(2):157–161. doi:[10.5604/20831862.1099047](https://doi.org/10.5604/20831862.1099047). **Access:** free copy in a repository ([copy](https://www.ncbi.nlm.nih.gov/pmc/articles/4042664)). **Local PDF:** no.
  - *Finding:* Reps at a given %1RM differed between trained and untrained lifters and between exercises.
  - *Used by:* Item 02
- **Shimano 2006.** Shimano T, Kraemer WJ, Spiering BA, et al. (2006). RELATIONSHIP BETWEEN THE NUMBER OF REPETITIONS AND SELECTED PERCENTAGES OF ONE REPETITION MAXIMUM IN FREE WEIGHT EXERCISES IN TRAINED AND UNTRAINED MEN. *The Journal of Strength and Conditioning Research* 20(4):819. doi:[10.1519/00124278-200611000-00015](https://doi.org/10.1519/00124278-200611000-00015). **Access:** paywalled. **Local PDF:** no.
  - *Finding:* Reps to failure at 60/80/90% differed by lift (more on squat than bench or curl).
  - *Used by:* Item 02
- **González-Badillo 2010.** González-Badillo JJ, Sánchez-Medina L (2010). Movement Velocity as a Measure of Loading Intensity in Resistance Training. *International Journal of Sports Medicine* 31(05):347–352. doi:[10.1055/s-0030-1248333](https://doi.org/10.1055/s-0030-1248333). **Access:** paywalled. **Local PDF:** no.
  - *Finding:* Bar speed tracks %1RM closely on the bench press, offering a load measure without a max test.
  - *Used by:* Item 02
- **Marzagão 2026.** Marzagão T. A weight-dependent 1RM prediction equation optimized on 303,494 near-failure sets across 388 exercises. arXiv:2603.17495 (preprint); 2026. [arxiv.org](https://arxiv.org/abs/2603.17495). **Access:** open (preprint). **Local PDF:** no.
  - *Finding:* Preprint fitting a 1RM equation to app data; it agrees with Epley for heavy sets and bends for light ones.
  - *Used by:* Items 02, 04 (the weight-dependent reps curve prior)
- **Kolossa 2017.** Kolossa D, Azhar MAB, Rasche C, et al. (2017). Performance Estimation using the Fitness-Fatigue Model with Kalman Filter Feedback. *Int. J. Comput. Sci. Sport* 16(2):117–129. doi:[10.1515/ijcss-2017-0010](https://doi.org/10.1515/ijcss-2017-0010). **Access:** open access (free OA journal) ([copy](https://content.sciendo.com/downloadpdf/journals/ijcss/16/2/article-p117.pdf)). **Local PDF:** no.
  - *Finding:* Fitness–fatigue model with Kalman feedback to estimate performance from training data.
  - *Used by:* Item 04 (precedent for a Kalman-filtered performance estimate)
- **Mitter 2022.** Mitter B, Csapo R, Bauer P, et al. (2022). Reproducibility of strength performance and strength-endurance profiles: A test-retest study. *PLoS ONE* 17(5):e0268074. doi:[10.1371/journal.pone.0268074](https://doi.org/10.1371/journal.pone.0268074). **Access:** open access (OA journal) ([copy](https://journals.plos.org/plosone/article/file?id=10.1371/journal.pone.0268074&type=printable)). **Local PDF:** no.
  - *Finding:* Test–retest of reps to failure on the bench: reliability was best at 70–80% of 1RM.
  - *Used by:* Item 05 (test protocol: about 8 reps, fresh, 0–1 RIR)
- **Morán-Navarro 2017.** Morán-Navarro R, Pérez CE, Mora-Rodríguez R, et al. (2017). Time course of recovery following resistance training leading or not to failure. *European Journal of Applied Physiology* 117(12):2387–2399. doi:[10.1007/s00421-017-3725-7](https://doi.org/10.1007/s00421-017-3725-7). **Access:** free copy in a repository ([copy](https://academica-e.unavarra.es/bitstreams/ed5c13b9-6af5-410c-bb6b-7318935de039/download)). **Local PDF:** no.
  - *Finding:* Sets to failure needed far longer recovery than the same work stopped short.
  - *Used by:* `estimators.ts` (at most one test set to failure a day)
- **Grgic 2020a.** Grgić J, Lazinica B, Schoenfeld BJ, et al. (2020). Test–Retest Reliability of the One-Repetition Maximum (1RM) Strength Assessment: a Systematic Review. *Sports Medicine - Open* 6(1):31. doi:[10.1186/s40798-020-00260-z](https://doi.org/10.1186/s40798-020-00260-z). **Access:** open access (OA journal) ([copy](https://sportsmedicine-open.springeropen.com/track/pdf/10.1186/s40798-020-00260-z)). **Local PDF:** no.
  - *Finding:* Systematic review: tested 1RM is highly reliable (typical CV about 4%).
  - *Used by:* `learn/capacity.ts`, `learn/deload.ts`, `learn/trend.ts` (1RM noise; the 8-week window); items 04, 06, 12
- **Latella 2020.** Latella C, Teo WP, Spathis JG, et al. (2020). Long-Term Strength Adaptation: A 15-Year Analysis of Powerlifting Athletes. *The Journal of Strength and Conditioning Research* 34(9):2412–2418. doi:[10.1519/jsc.0000000000003657](https://doi.org/10.1519/jsc.0000000000003657). **Access:** open access (publisher, hybrid). **Local PDF:** no.
  - *Finding:* 15 years of powerlifting meet data: how fast strength rises over a career.
  - *Used by:* `learn/capacity.ts`, `learn/trend.ts` (priors for long-term strength gain)
- **Latella 2022.** Latella C, Owen PJ, Davies TB, et al. (2022). Long-Term Adaptations in the Squat, Bench Press, and Deadlift: Assessing Strength Gain in Powerlifting Athletes. *Medicine & Science in Sports & Exercise* 54(5):841–850. doi:[10.1249/mss.0000000000002858](https://doi.org/10.1249/mss.0000000000002858). **Access:** paywalled; repository record: [ECU 628](https://ro.ecu.edu.au/ecuworks2022-2026/628). **Local PDF:** no.
  - *Finding:* Follow-up on long-term gains in the squat, bench and deadlift across competitive lifters.
  - *Used by:* Item 04
- **Bosquet 2013.** Bosquet L, Berryman N, Dupuy O, et al. (2013). Effect of training cessation on muscular performance: A meta‐analysis. *Scandinavian Journal of Medicine and Science in Sports* 23(3):e140–9. doi:[10.1111/sms.12047](https://doi.org/10.1111/sms.12047). **Access:** paywalled. **Local PDF:** no.
  - *Finding:* Meta-analysis of 103 studies: strength holds for a few weeks off, then declines with longer breaks.
  - *Used by:* `learn/capacity.ts`, `learn/deload.ts`, `learn/rest.ts`, `learn/strength.ts`, `learn/trend.ts` (losses after a layoff)
- **Keogh & Winwood 2017.** Keogh J, Winwood P (2017). The Epidemiology of Injuries Across the Weight-Training Sports. *Sports Medicine* 47(3):479–501. doi:[10.1007/s40279-016-0575-0](https://doi.org/10.1007/s40279-016-0575-0). **Access:** free copy in a repository ([copy](https://pure.bond.edu.au/ws/files/10320456/The_epidemiology_of_injuries_across_the_weight_training_sports.pdf)). **Local PDF:** no.
  - *Finding:* Review of injury rates across weight-training sports: roughly 1–4 injuries per 1,000 hours.
  - *Used by:* Items 05, 08 (testing and training are low-risk)

## Progression and load steps

- **Plotkin 2022.** Plotkin DL, Coleman M, van Every DW, et al. (2022). Progressive overload without progressing load? The effects of load or repetition progression on muscular adaptations. *PeerJ* 10:e14142. doi:[10.7717/peerj.14142](https://doi.org/10.7717/peerj.14142). **Access:** open access (OA journal). **Local PDF:** no.
  - *Finding:* Trained lifters: adding load at fixed reps and adding reps at a fixed load grew muscle alike.
  - *Used by:* `progression.ts` double progression; item 01
- **Chaves 2024.** Chaves TS, Scarpelli MC, Bergamasco JGA, et al. (2024). Effects of Resistance Training Overload Progression Protocols on Strength and Muscle Mass. *International Journal of Sports Medicine* 45(07):504–510. doi:[10.1055/a-2256-5857](https://doi.org/10.1055/a-2256-5857). **Access:** free to read at the publisher (no open licence) ([copy](http://www.thieme-connect.de/products/ejournals/pdf/10.1055/a-2256-5857.pdf)). **Local PDF:** no.
  - *Finding:* Within-person trial: progressing load or reps on the leg extension gave the same strength and size.
  - *Used by:* Item 01
- **Mann 2010.** Mann JB, Thyfault JP, Ivey PA, et al. (2010). The Effect of Autoregulatory Progressive Resistance Exercise vs. Linear Periodization on Strength Improvement in College Athletes. *The Journal of Strength and Conditioning Research* 24(7):1718–1723. doi:[10.1519/jsc.0b013e3181def4a6](https://doi.org/10.1519/jsc.0b013e3181def4a6). **Access:** paywalled. **Local PDF:** no.
  - *Finding:* Athletes using APRE, where the next load follows reps achieved, gained more than on linear periodization.
  - *Used by:* Item 01 (reps-based load changes)
- **Mota 2014.** Mota JA, et al. Conference abstract on fixed per-session barbell increments; Int J Exerc Sci Conf Proc; 2014. [digitalcommons.usu.edu](https://digitalcommons.usu.edu/hper_facpub/641). **Access:** free (abstract). **Local PDF:** no.
  - *Finding:* Fixed 2.3 kg-a-session steps worked for weeks in men while women stalled sooner; smaller steps were suggested.
  - *Used by:* Item 01 (small steps for lighter lifters)

## Rest between sets and fatigue within a session

- **Senna 2011.** Senna GW, Willardson JM, de Salles BF, et al. (2011). The Effect of Rest Interval Length on Multi and Single-Joint Exercise Performance and Perceived Exertion. *The Journal of Strength and Conditioning Research* 25(11):3157–3162. doi:[10.1519/jsc.0b013e318212e23b](https://doi.org/10.1519/jsc.0b013e318212e23b). **Access:** paywalled. **Local PDF:** no.
  - *Finding:* Reps held up better with longer rests in both multi- and single-joint lifts.
  - *Used by:* `timing.ts` rest base (direction); 00-core §4.1
- **Senna 2016.** Senna GW, Willardson JM, Scudese E, et al. (2016). Effect of Different Interset Rest Intervals on Performance of Single and Multijoint Exercises With Near-Maximal Loads. *The Journal of Strength and Conditioning Research* 30(3):710–716. doi:[10.1519/jsc.0000000000001142](https://doi.org/10.1519/jsc.0000000000001142). **Access:** paywalled. **Local PDF:** no.
  - *Finding:* Near-max sets: 2 min was enough on a fly, while bench needed 3–5 min to hold reps.
  - *Used by:* `timing.ts` rest base (2:00 small lift, 3:00 big lift), `learn/capacity.ts` recovery prior
- **Scudese 2015.** Scudese E, Willardson JM, Simão RF, et al. (2015). The Effect of Rest Interval Length on Repetition Consistency and Perceived Exertion During Near Maximal Loaded Bench Press Sets. *The Journal of Strength and Conditioning Research* 29(11):3079–3083. doi:[10.1097/jsc.0000000000000214](https://doi.org/10.1097/jsc.0000000000000214). **Access:** paywalled. **Local PDF:** no.
  - *Finding:* Bench reps stayed consistent with 3–5 min of rest at near-maximal loads.
  - *Used by:* `timing.ts` 5:00 ceiling
- **de Salles 2009.** de Salles BF, Simão RF, Miranda F, et al. (2009). Rest Interval between Sets in Strength Training. *Sports Medicine* 39(9):765–777. doi:[10.2165/11315230-000000000-00000](https://doi.org/10.2165/11315230-000000000-00000). **Access:** paywalled. **Local PDF:** no.
  - *Finding:* Review of rest-interval research: 3–5 min preserves reps at heavy loads; shorter rests cut volume.
  - *Used by:* `timing.ts` 5:00 ceiling; 00-core §4.1
- **de Salles 2016.** de Salles BF, Polito MD, Goessler KF, et al. (2016). Effects of fixed vs. self‐suggested rest between sets in upper and lower body exercises performance. *European Journal of Sport Science* 16(8):927–931. doi:[10.1080/17461391.2016.1161831](https://doi.org/10.1080/17461391.2016.1161831). **Access:** paywalled. **Local PDF:** no.
  - *Finding:* Self-chosen rests performed about as well as fixed rests.
  - *Used by:* 00-core §4.1 (self-selected rest)
- **Ratamess 2007.** Ratamess NA, Falvo MJ, Mangine GT, et al. (2007). The effect of rest interval length on metabolic responses to the bench press exercise. *European Journal of Applied Physiology* 100(1):1–17. doi:[10.1007/s00421-007-0394-y](https://doi.org/10.1007/s00421-007-0394-y). **Access:** paywalled. **Local PDF:** no.
  - *Finding:* Bench sets lost 15–55% of their reps with 30 s to 1 min of rest.
  - *Used by:* `timing.ts` 0:45 floor, `learn/capacity.ts`
- **Rahimi 2005.** Rahimi R (2005). Effect of different rest intervals on the exercise volume completed during squat bouts. 4(4):361–6. PMID [24501549](https://pubmed.ncbi.nlm.nih.gov/24501549/). **Access:** free copy in a repository ([copy](https://www.ncbi.nlm.nih.gov/pmc/articles/3899651)). **Local PDF:** no.
  - *Finding:* Squat set 2 reached 62/73/91% of set 1 after 1, 2 and 5 min of rest.
  - *Used by:* `learn/capacity.ts`, `learn/rest.ts` (recovery curve points)
- **Harris 1976.** Harris RC, Edwards RHT, Hultman E, et al. (1976). The time course of phosphorylcreatine resynthesis during recovery of the quadriceps muscle in man. *Pflügers Archiv - European Journal of Physiology* 367(2):137–142. doi:[10.1007/bf00585149](https://doi.org/10.1007/bf00585149). **Access:** paywalled. **Local PDF:** no.
  - *Finding:* Phosphocreatine recovers with a fast phase (~21 s) and a slow phase (minutes).
  - *Used by:* `learn/capacity.ts` (recovery time constant prior)
- **Willardson & Burkett 2006.** Willardson JM, Burkett LN (2006). THE EFFECT OF REST INTERVAL LENGTH ON BENCH PRESS PERFORMANCE WITH HEAVY VS.LIGHT LOADS. *The Journal of Strength and Conditioning Research* 20(2):396. doi:[10.1519/00124278-200605000-00027](https://doi.org/10.1519/00124278-200605000-00027). **Access:** paywalled. **Local PDF:** no.
  - *Finding:* The rest needed did not differ between 80% and 50% of 1RM sets.
  - *Used by:* Why `timing.ts` no longer adds rest for heavy loads (00-core §4.1)
- **Schoenfeld 2016.** Schoenfeld BJ, Pope ZK, Benik FM, et al. (2016). Longer Interset Rest Periods Enhance Muscle Strength and Hypertrophy in Resistance-Trained Men. *The Journal of Strength and Conditioning Research* 30(7):1805–1812. doi:[10.1519/jsc.0000000000001272](https://doi.org/10.1519/jsc.0000000000001272). **Access:** paywalled. **Local PDF:** no.
  - *Finding:* Trained men gained more strength and thigh size with 3 min than 1 min rests.
  - *Used by:* 00-core §4.1 (rest context)
- **Grgic 2018.** Grgić J, Schoenfeld BJ, Skrepnik M, et al. (2018). Effects of Rest Interval Duration in Resistance Training on Measures of Muscular Strength: A Systematic Review. *Sports Medicine* 48(1):137–151. doi:[10.1007/s40279-017-0788-x](https://doi.org/10.1007/s40279-017-0788-x). **Access:** paywalled. **Local PDF:** no.
  - *Finding:* Systematic review: in trained lifters, rests over 2 min maximize strength; in novices rest matters less.
  - *Used by:* 00-core §4.1 (more than 2 min for trained strength); also in ACSM 2026
- **Longo 2022.** Longo AR, Silva-Batista C, Pedroso K, et al. (2022). Volume Load Rather Than Resting Interval Influences Muscle Hypertrophy During High-Intensity Resistance Training. *The Journal of Strength and Conditioning Research* 36(6):1554–1559. doi:[10.1519/jsc.0000000000003668](https://doi.org/10.1519/jsc.0000000000003668). **Access:** paywalled. **Local PDF:** no.
  - *Finding:* Rest affected growth only through the volume load it let lifters complete.
  - *Used by:* 00-core §4.1 (rest protects reps, which is why the timer exists)
- **Singer 2024.** Singer A, Wolf M, Generoso L, et al. (2024). Give it a rest: a systematic review with Bayesian meta-analysis on the effect of inter-set rest interval duration on muscle hypertrophy. *Frontiers in Sports and Active Living* 6:1429789. doi:[10.3389/fspor.2024.1429789](https://doi.org/10.3389/fspor.2024.1429789). **Access:** open access (OA journal) ([copy](https://www.frontiersin.org/journals/sports-and-active-living/articles/10.3389/fspor.2024.1429789/pdf)). **Local PDF:** no.
  - *Finding:* Bayesian meta-analysis: a small growth benefit for rests over 60 s, with little difference past about 90 s.
  - *Used by:* 00-core §4.1; item 11
- **Janićijević 2024.** Janicijevic DN, Miras-Moreno S, Morenas-Aguilar MD, et al. (2024). Does the Length of Inter-Set Rest Periods Impact the Volume of Bench Pull Repetitions Completed before Surpassing Various Cut-Off Velocities? *Journal of Human Kinetics* 95:139–150. doi:[10.5114/jhk/188366](https://doi.org/10.5114/jhk/188366). **Access:** open access (free OA journal) ([copy](https://jhk.termedia.pl/pdf-188366-117155?filename=Does the Length of.pdf)). **Local PDF:** no.
  - *Finding:* Rest needed to hold reps grew the closer sets went to failure (about 5 min near failure, 3 min further away).
  - *Used by:* `timing.ts` (more rest after a set at RIR 0, less at RIR 3+)
- **Refalo 2023b.** Refalo MC, Helms ER, Hamilton DL, et al. (2023). Influence of Resistance Training Proximity-to-Failure, Determined by Repetitions-in-Reserve, on Neuromuscular Fatigue in Resistance-Trained Males and Females. *Sports Medicine - Open* 9(1):10. doi:[10.1186/s40798-023-00554-y](https://doi.org/10.1186/s40798-023-00554-y). **Access:** open access (OA journal) ([copy](https://sportsmedicine-open.springeropen.com/counter/pdf/10.1186/s40798-023-00554-y)). **Local PDF:** no.
  - *Finding:* Rep loss over six sets at fixed rest was largest at failure and smallest at 3 RIR.
  - *Used by:* `timing.ts`, `learn/rest.ts`, `learn/capacity.ts` (rep loss by RIR)
- **Iversen 2021.** Iversen VM, Norum M, Schoenfeld BJ, et al. (2021). No Time to Lift? Designing Time-Efficient Training Programs for Strength and Hypertrophy: A Narrative Review. *Sports Medicine* 51(10):2079–2095. doi:[10.1007/s40279-021-01490-1](https://doi.org/10.1007/s40279-021-01490-1). **Access:** open access (publisher, hybrid) ([copy](https://link.springer.com/content/pdf/10.1007/s40279-021-01490-1.pdf)). **Local PDF:** no.
  - *Finding:* Narrative review of ways to train in less time: supersets, shorter rests, fewer exercises.
  - *Used by:* Item 11 (time-efficient training)
- **Soares 2016.** Soares EG, Brown LE, Gomes WA, et al. (2016). Comparison Between Pre-Exhaustion and Traditional Exercise Order on Muscle Activation and Performance in Trained Men. *Journal of Sports Science and Medicine* 15(1):111–117. PMID [26957933](https://pubmed.ncbi.nlm.nih.gov/26957933/). **Access:** free copy in a repository ([copy](https://www.ncbi.nlm.nih.gov/pmc/articles/4763829)). **Local PDF:** no.
  - *Finding:* A synergist set done first cost about 2 reps (≈20%) on the next lift.
  - *Used by:* `learn/capacity.ts` (a prior set for an overlapping muscle costs reps); item 10
- **Augustsson 2003.** Augustsson J, Thomeé R, Hörnstedt P, et al. (2003). Effect of Pre-Exhaustion Exercise on Lower-Extremity Muscle Activation During a Leg Press Exercise. *The Journal of Strength and Conditioning Research* 17(2):411. doi:[10.1519/00124278-200305000-00032](https://doi.org/10.1519/00124278-200305000-00032). **Access:** paywalled. **Local PDF:** no.
  - *Finding:* Pre-exhausting the quads with leg extensions cut leg-press performance.
  - *Used by:* `learn/capacity.ts`
- **Spreuwenberg 2006.** Spreuwenberg LPB, Kraemer WJ, Spiering BA, et al. (2006). INFLUENCE OF EXERCISE ORDER IN A RESISTANCE-TRAINING EXERCISE SESSION. *The Journal of Strength and Conditioning Research* 20(1):141. doi:[10.1519/00124278-200602000-00022](https://doi.org/10.1519/00124278-200602000-00022). **Access:** paywalled. **Local PDF:** no.
  - *Finding:* Squats done after a full session lost about a third of their reps.
  - *Used by:* `learn/capacity.ts`; item 10
- **Behm 2021.** Behm DG, Alizadeh S, Anvar SH, et al. (2021). Non-local Muscle Fatigue Effects on Muscle Strength, Power, and Endurance in Healthy Individuals: A Systematic Review with Meta-analysis. *Sports Medicine* 51(9):1893–1907. doi:[10.1007/s40279-021-01456-3](https://doi.org/10.1007/s40279-021-01456-3). **Access:** free copy in a repository ([copy](https://pure.solent.ac.uk/en/publications/f161a68f-61e5-4690-b4a0-fcf854507274)). **Local PDF:** no.
  - *Finding:* Meta-analysis: fatiguing one muscle barely affects strength in others, but trims reps to failure a little.
  - *Used by:* `learn/capacity.ts` (fatigue from unrelated lifts is small)
- **Alonso-Aubin 2024.** Alonso-Aubin DA, Hernández-Lougedo J, Cavero-Haro A, et al. (2024). Acute Effect of Fixed vs. Self-Selected Rest Interval Between Sets on Physiological and Performance-Related Responses. *Journal of Functional Morphology and Kinesiology* 9(4):200. doi:[10.3390/jfmk9040200](https://doi.org/10.3390/jfmk9040200). **Access:** open access (OA journal) ([copy](https://www.mdpi.com/2411-5142/9/4/200/pdf)). **Local PDF:** no.
  - *Finding:* Acute trial: lifters choosing their own rest took about 97 s against a 120 s prescription.
  - *Used by:* Item 11 (people choose shorter rests than prescribed)
- **Fidalgo 2023.** Fidalgo A, Farinatti P, Miranda HL, et al. (2023). Are Self-selected Intervals as Effective as Fixed Intervals in Controlling Acute Responses in High-Intensity Interval Resistance Training? *International journal of exercise science* 16(4):1205–1215. doi:[10.70252/bovs2537](https://doi.org/10.70252/bovs2537). **Access:** open access (free OA journal). **Local PDF:** no.
  - *Finding:* Acute trial in which self-chosen rests ran slightly shorter than a fixed short rest.
  - *Used by:* Item 11

## Weekly volume per muscle

- **Pelland 2026.** Pelland JC, Remmert JF, Robinson ZP, et al. (2026). The Resistance Training Dose Response: Meta-Regressions Exploring the Effects of Weekly Volume and Frequency on Muscle Hypertrophy and Strength Gains. *Sports Medicine* 56(2):481–505. doi:[10.1007/s40279-025-02344-w](https://doi.org/10.1007/s40279-025-02344-w). **Access:** paywalled; free preprint: [SportRxiv 460](https://sportrxiv.org/index.php/server/preprint/view/460) (v2, 2024-10-04, the latest posted). **Local PDF:** yes: `pelland-2026-srxiv460-v2/` (the preprint).
  - *Finding:* Bayesian meta-regression of 67 studies: more weekly sets grow more with diminishing returns; fractional set counting fit best.
  - *Used by:* `learn/volume.ts`, `analytics.ts`, `lifts.ts` (fractional sets, indirect ½); items 07, 13; ACSM 2026 ref 187; readiness (planned): weekly planner √-volume objective
- **Remmert 2025.** Remmert JF, Pelland JC, Robinson ZP, et al. (2025). Is There Too Much of a Good Thing?.. doi:[10.51224/srxiv.537](https://doi.org/10.51224/srxiv.537). **Access:** open access (OA journal) ([copy](https://sportrxiv.org/index.php/server/preprint/download/537/1148/1071)); preprint (SportRxiv 537). **Local PDF:** yes: `remmert-2025-srxiv537/`.
  - *Finding:* Preprint: past about 11 fractional sets for a muscle in one session, extra sets showed no detectable added growth.
  - *Used by:* `analytics.ts` `SESSION_CAP = 11`; item 07; readiness (planned): planner session cap
- **Boutagy & McKean 2026.** Boutagy AG, McKean MR (2026). Weekly training volume, but not its division into sessions, is associated with resistance-training hypertrophy. Preprint. doi:[10.51224/sportrxiv.1100](https://doi.org/10.51224/sportrxiv.1100). **Access:** open access (preprint, SportRxiv 1100; not peer reviewed; abstract read). **Local PDF:** no.
  - *Finding:* Re-analysis of the Pelland 2026 dataset: with weekly sets fixed, splitting them over more sessions made no detectable difference to growth, so a per-session curve adds nothing beyond weekly volume; for strength, more sessions may help (not confirmed by the randomised contrasts alone).
  - *Used by:* readiness (planned): why the planner's session cap is a soft spreading rule, not a growth limit
- **Scarpelli 2022.** Scarpelli MC, Nóbrega SR, Santanielo N, et al. (2022). Muscle Hypertrophy Response Is Affected by Previous Resistance Training Volume in Trained Individuals. *The Journal of Strength and Conditioning Research* 36(4):1153–1157. doi:[10.1519/jsc.0000000000003558](https://doi.org/10.1519/jsc.0000000000003558). **Access:** paywalled. **Local PDF:** no.
  - *Finding:* Within-person trial: a leg trained at 1.2× the lifter's own usual weekly sets grew more than one on a fixed standard volume.
  - *Used by:* `learn/volume.ts` `STEP = 0.2`
- **Barsuhn 2025.** Barsuhn A, Wadhi T, Murphy A, et al. (2025). Training volume increases or maintenance based on previous volume: the effects on muscular adaptations in trained males. *Journal of Applied Physiology* 138(1):259–269. doi:[10.1152/japplphysiol.00476.2024](https://doi.org/10.1152/japplphysiol.00476.2024). **Access:** free copy in a repository ([copy](https://openrepository.aut.ac.nz/bitstreams/4f83ffc5-1aad-4dc8-92fb-1c28156b3211/download)). **Local PDF:** no.
  - *Finding:* Trained men: adding 30% or 60% to their usual volume grew no more than keeping it.
  - *Used by:* `learn/volume.ts` (`BASE_WEEKS = 3`, never more than +20%, hold in range)
- **Aube 2022.** Aube D, Wadhi T, Rauch JT, et al. (2022). Progressive Resistance Training Volume: Effects on Muscle Thickness, Mass, and Strength Adaptations in Resistance-Trained Individuals. 36(3):600–607. doi:[10.1519/jsc.0000000000003524](https://doi.org/10.1519/jsc.0000000000003524). **Access:** paywalled. **Local PDF:** no.
  - *Finding:* Trained lifters: 12, 18 and 24 weekly lower-body sets gave similar muscle growth.
  - *Used by:* `learn/volume.ts` (hold in or above the band)
- **Räntilä & Ahtiainen 2026.** Räntilä A, Ahtiainen JP (2026). Exploring the Upper Limits of Resistance Training Volume for Muscle Hypertrophy and Strength in Trained Athletes. *Journal of Science in Sport and Exercise*. doi:[10.1007/s42978-026-00387-7](https://doi.org/10.1007/s42978-026-00387-7). **Access:** open access (publisher, hybrid) ([copy](https://link.springer.com/content/pdf/10.1007/s42978-026-00387-7.pdf)). **Local PDF:** no.
  - *Finding:* Strength athletes on 1.5× their sets for 7 weeks gained no extra size or strength.
  - *Used by:* Item 07 (no blanket volume increases)
- **Enes 2024.** Enes AAN, de Souza EO, de Souza TP (2024). Effects of Different Weekly Set Progressions on Muscular Adaptations in Trained Males: Is There a Dose–Response Effect? *Medicine & Science in Sports & Exercise* 56(3):553–563. doi:[10.1249/mss.0000000000003317](https://doi.org/10.1249/mss.0000000000003317). **Access:** paywalled. **Local PDF:** no.
  - *Finding:* Adding sets every two weeks beat constant volume for 1RM in trained men; size effects were mixed.
  - *Used by:* 00-core §5 (planned progression blocks)
- **Baz-Valle 2022.** Baz-Valle E, Balsalobre-Fernández C, Alix-Fages C, et al. (2022). A Systematic Review of the Effects of Different Resistance Training Volumes on Muscle Hypertrophy. *Journal of Human Kinetics* 81:199–210. doi:[10.2478/hukin-2022-0017](https://doi.org/10.2478/hukin-2022-0017). **Access:** open access (free OA journal) ([copy](https://jhk.termedia.pl/pdf-158681-84943?filename=A Systematic Review of.pdf)). **Local PDF:** no.
  - *Finding:* Review in trained men: 12–20 weekly sets is a sensible range; more helped only the triceps.
  - *Used by:* Item 07 (band of about 12–20 weekly sets)
- **Schoenfeld 2017b.** Schoenfeld BJ, Ogborn DI, Krieger JW (2017). Dose-response relationship between weekly resistance training volume and increases in muscle mass: A systematic review and meta-analysis. *Journal of Sports Sciences* 35(11):1073–1082. doi:[10.1080/02640414.2016.1210197](https://doi.org/10.1080/02640414.2016.1210197). **Access:** paywalled. **Local PDF:** no.
  - *Finding:* Meta-analysis: each added weekly set brings a little more growth, with about 10+ sets beating fewer.
  - *Used by:* Item 07
- **Schoenfeld 2019.** Schoenfeld BJ, Contreras BM, Krieger JW, et al. (2019). Resistance Training Volume Enhances Muscle Hypertrophy but Not Strength in Trained Men. *Medicine & Science in Sports & Exercise* 51(1):94–103. doi:[10.1249/mss.0000000000001764](https://doi.org/10.1249/mss.0000000000001764). **Access:** open access (publisher, hybrid). **Local PDF:** no.
  - *Finding:* Trained men on 1, 3 or 5 sets per exercise: the most volume grew the most, with no extra strength.
  - *Used by:* Item 07
- **Damas 2019.** Damas F, Angleri V, Phillips SM, et al. (2019). Myofibrillar protein synthesis and muscle hypertrophy individualized responses to systematically changing resistance training variables in trained young men. *Journal of Applied Physiology* 127(3):806–815. doi:[10.1152/japplphysiol.00350.2019](https://doi.org/10.1152/japplphysiol.00350.2019). **Access:** paywalled. **Local PDF:** no.
  - *Finding:* Differences between people in muscle growth dwarfed the effect of changing training variables.
  - *Used by:* Item 07 (why the app learns per person)
- **Bickel 2011.** Bickel CS, Cross JM, Bamman MM (2011). Exercise Dosing to Retain Resistance Training Adaptations in Young and Older Adults. *Medicine & Science in Sports & Exercise* 43(7):1177–1187. doi:[10.1249/mss.0b013e318207c15d](https://doi.org/10.1249/mss.0b013e318207c15d). **Access:** paywalled. **Local PDF:** no.
  - *Finding:* Muscle and strength were maintained on a third of the training dose for months, in young adults.
  - *Used by:* 00-core §5, items 07, 13 (cuts maintain, they don't build)
- **Hickmott 2022.** Hickmott LM, Chilibeck PD, Shaw KA, et al. (2022). The Effect of Load and Volume Autoregulation on Muscular Strength and Hypertrophy: A Systematic Review and Meta-Analysis. *Sports Medicine - Open* 8(1):9. doi:[10.1186/s40798-021-00404-9](https://doi.org/10.1186/s40798-021-00404-9). **Access:** open access (OA journal) ([copy](https://sportsmedicine-open.springeropen.com/track/pdf/10.1186/s40798-021-00404-9)). **Local PDF:** no.
  - *Finding:* Meta-analysis of load and volume autoregulation; effects small and evidence thin.
  - *Used by:* Item 07; also in ACSM 2026 (autoregulation)
- **Schoenfeld & Contreras 2013.** Schoenfeld BJ, Contreras BM (2013). Is Postexercise Muscle Soreness a Valid Indicator of Muscular Adaptations? *Strength and conditioning journal* 35(5):16–21. doi:[10.1519/ssc.0b013e3182a61820](https://doi.org/10.1519/ssc.0b013e3182a61820). **Access:** paywalled. **Local PDF:** no.
  - *Finding:* Soreness is a poor guide to whether training is building muscle.
  - *Used by:* Item 07 (why the app ignores soreness)

## Recovery between sessions

- **Raastad & Hallén 2000.** Raastad T, Hallén J (2000). Recovery of skeletal muscle contractility after high- and moderate-intensity strength exercise. *European Journal of Applied Physiology* 82(3):206–214. doi:[10.1007/s004210050673](https://doi.org/10.1007/s004210050673). **Access:** paywalled (abstract read). **Local PDF:** no.
  - *Finding:* Ten strength athletes: heavy 3–6RM leg work cut knee-extension strength about twice as much as the same session at 70% of the load; the light session was back to baseline within 3 h, the heavy one only by 33 h.
  - *Used by:* readiness (planned): recovery time-constant prior
- **Morán-Navarro 2017.** Morán-Navarro R, Pérez CE, Mora-Rodríguez R, et al. (2017). Time course of recovery following resistance training leading or not to failure. *European Journal of Applied Physiology* 117(12):2387–2399. doi:[10.1007/s00421-017-3725-7](https://doi.org/10.1007/s00421-017-3725-7). **Access:** free copy in a repository ([copy](https://academica-e.unavarra.es/bitstreams/ed5c13b9-6af5-410c-bb6b-7318935de039/download); accepted manuscript, figures not included). **Local PDF:** yes: `moran-navarro-2017/`.
  - *Finding:* Same reps at 75% 1RM in bench press and squat: sets to failure kept jump height and bar speed down for 48 h or more, while the volume-matched non-failure sessions were back within 6 h.
  - *Used by:* readiness (planned): recovery time-constant prior and the failure multiplier
- **Bartolomei 2017.** Bartolomei S, Sadres E, Church DD, et al. (2017). Comparison of the recovery response from high-intensity and high-volume resistance exercise in trained men. *European Journal of Applied Physiology* 117(7):1287–1298. doi:[10.1007/s00421-017-3598-9](https://doi.org/10.1007/s00421-017-3598-9). **Access:** paywalled (repository records at UCF and Bologna hold no file; abstract read). **Local PDF:** no.
  - *Finding:* Twelve trained men: after 8×10 isometric leg strength was still down at 72 h; after heavy 8×3 it was not.
  - *Used by:* readiness (planned): recovery time-constant prior
- **Vieira 2022.** Vieira JG, Sardeli AV, Dias MR, et al. (2022). Effects of Resistance Training to Muscle Failure on Acute Fatigue: A Systematic Review and Meta-Analysis. *Sports Medicine* 52(5):1103–1125. doi:[10.1007/s40279-021-01602-x](https://doi.org/10.1007/s40279-021-01602-x). **Access:** free copy in a repository ([record](https://research.birmingham.ac.uk/en/publications/e4ef6f78-1b3a-4467-a056-acb27d23f355); behind a bot check, not read; abstract read). **Local PDF:** no.
  - *Finding:* Meta-analysis of 12 crossover studies: sets to failure cost more acute performance and more muscle damage at 48 h than non-failure sets.
  - *Used by:* readiness (planned): direction of the failure multiplier
- **MacDougall 1995.** MacDougall JD, Gibala MJ, Tarnopolsky MA, et al. (1995). The time course for elevated muscle protein synthesis following heavy resistance exercise. *Canadian Journal of Applied Physiology* 20(4):480–486. doi:[10.1139/h95-038](https://doi.org/10.1139/h95-038). **Access:** paywalled (abstract read). **Local PDF:** no.
  - *Finding:* Six young men: muscle protein synthesis was about double at 24 h after heavy arm training and nearly back to baseline by about 36 h.
  - *Used by:* readiness (planned): background only, not a model input
- **Nosaka 2002.** Nosaka K, Newton MJ, Sacco P (2002). Delayed-onset muscle soreness does not reflect the magnitude of eccentric exercise-induced muscle damage. *Scandinavian Journal of Medicine & Science in Sports* 12(6):337–346. doi:[10.1034/j.1600-0838.2002.10178.x](https://doi.org/10.1034/j.1600-0838.2002.10178.x). **Access:** paywalled (the Edith Cowan repository record holds no file; abstract read). **Local PDF:** no.
  - *Finding:* 110 people doing three doses of eccentric elbow work: how sore they got was barely related to strength loss or other damage markers.
  - *Used by:* readiness (planned): why soreness is not an input
- **Cheung 2003.** Cheung K, Hume P, Maxwell L (2003). Delayed onset muscle soreness: treatment strategies and performance factors. *Sports Medicine* 33(2):145–164. doi:[10.2165/00007256-200333020-00005](https://doi.org/10.2165/00007256-200333020-00005). **Access:** paywalled (abstract read). **Local PDF:** no.
  - *Finding:* Review of soreness: its causes are unsettled, most treatments do little, and it advises easing off the sorest muscles for a day or two.
  - *Used by:* readiness (planned): background only

## Deloads, overreaching and fatigue

- **Bell 2023 (deload Delphi).** Bell L, Strafford BW, Coleman M, et al. (2023). Integrating Deloading into Strength and Physique Sports Training Programmes: An International Delphi Consensus Approach. *Sports Medicine - Open* 9(1):87. doi:[10.1186/s40798-023-00633-0](https://doi.org/10.1186/s40798-023-00633-0). **Access:** open access (OA journal) ([copy](https://sportsmedicine-open.springeropen.com/counter/pdf/10.1186/s40798-023-00633-0)); repository copy: [SHU 32417](https://shura.shu.ac.uk/32417/). **Local PDF:** no.
  - *Finding:* Delphi consensus of coaches and scientists on what a deload is and when to use one.
  - *Used by:* `learn/deload.ts` (no study shows a deload helps; suggestions, not schedules)
- **Bell 2025 (SCJ).** Bell L, Darragh IAJ, Travis SK, et al. (2025). A Practical Approach to Deloading: Recommendations and Considerations for Strength and Physique Sports. *Strength and conditioning journal* 48(4):413–423. doi:[10.1519/ssc.0000000000000910](https://doi.org/10.1519/ssc.0000000000000910). **Access:** free copy in a repository ([copy](https://doras.dcu.ie/31501/1/a_practical_approach_to_deloading__recommendations.203%282%29.pdf)); repository copy: [SHU 35313](https://shura.shu.ac.uk/35313/). **Local PDF:** no.
  - *Finding:* Practical review on designing deloads: lower volume, load or effort for about a week.
  - *Used by:* `learn/deload.ts` `LIGHT` (half the sets, about −10% load, 1–3 RIR further); `estimators.ts` (no test in a light week); `progression.ts` light week
- **Bell 2020 (scoping).** Bell L, Ruddock AD, Maden-Wilkinson T, et al. (2020). Overreaching and overtraining in strength sports and resistance training: A scoping review. *Journal of Sports Sciences* 38(16):1897–1912. doi:[10.1080/02640414.2020.1763077](https://doi.org/10.1080/02640414.2020.1763077). **Access:** paywalled. **Local PDF:** no.
  - *Finding:* Scoping review of overreaching and overtraining in strength sports: markers and outcomes.
  - *Used by:* Item 06
- **Rogerson 2024.** Rogerson D, Nolan D, Androulakis-Korakakis P, et al. (2024). Deloading Practices in Strength and Physique Sports: A Cross-sectional Survey. *Sports Medicine - Open* 10(1):26. doi:[10.1186/s40798-024-00691-y](https://doi.org/10.1186/s40798-024-00691-y). **Access:** open access (OA journal) ([copy](https://sportsmedicine-open.springeropen.com/counter/pdf/10.1186/s40798-024-00691-y)). **Local PDF:** no.
  - *Finding:* Survey of 246 coaches and athletes: deloads last about a week and are often triggered by feeling beaten up.
  - *Used by:* `learn/deload.ts` (`BREAK_DAYS`/`LIGHT_DAYS` = 7)
- **Coleman 2024.** Coleman M, Burke R, Augustin F, et al. (2024). Gaining more from doing less? The effects of a one-week deload period during supervised resistance training on muscular adaptations. *PeerJ* 12:e16777. doi:[10.7717/peerj.16777](https://doi.org/10.7717/peerj.16777). **Access:** open access (OA journal) ([copy](https://peerj.com/articles/16777.pdf)). **Local PDF:** no.
  - *Finding:* RCT in trained lifters: a one-week break mid-program cost no muscle and slightly blunted strength.
  - *Used by:* `learn/deload.ts`, `learn/volume.ts` (a week off costs no muscle)
- **Vann 2021.** Vann CG, Haun CT, Osburn SC, et al. (2021). Molecular Differences in Skeletal Muscle After 1 Week of Active vs. Passive Recovery From High-Volume Resistance Training. *The Journal of Strength and Conditioning Research* 35(8):2102–2113. doi:[10.1519/jsc.0000000000004071](https://doi.org/10.1519/jsc.0000000000004071). **Access:** paywalled. **Local PDF:** no.
  - *Finding:* Small trial of a light-training week versus full rest after high volume; strength did not differ.
  - *Used by:* `learn/deload.ts` (cost ratio)
- **Grandou 2020a.** Grandou C, Wallace L, Impellizzeri FM, et al. (2020). Overtraining in Resistance Exercise: An Exploratory Systematic Review and Methodological Appraisal of the Literature. *Sports Medicine* 50(4):815–828. doi:[10.1007/s40279-019-01242-2](https://doi.org/10.1007/s40279-019-01242-2). **Access:** paywalled. **Local PDF:** no.
  - *Finding:* Systematic review: no marker beats a sustained fall in performance for spotting overtraining in resistance exercise.
  - *Used by:* `learn/deload.ts`, `rotation.ts`, `learn/volume.ts` (only a sustained drop in performance marks overreaching)
- **Grandou 2020b (survey).** Grandou C, Wallace L, Coutts AJ, et al. (2020). Symptoms of Overtraining in Resistance Exercise: International Cross-Sectional Survey. *International Journal of Sports Physiology and Performance* 16(1):80–89. doi:[10.1123/ijspp.2019-0825](https://doi.org/10.1123/ijspp.2019-0825). **Access:** free to read at the publisher (no open licence) ([copy](https://journals.humankinetics.com/downloadpdf/journals/ijspp/16/1/article-p80.pdf)); repository copy: [SHU 26713](https://shura.shu.ac.uk/26713). **Local PDF:** no.
  - *Finding:* Survey of 605 lifters: what overtraining felt like and how they responded.
  - *Used by:* Item 06
- **Saw 2016.** Saw AE, Main LC, Gastin PB (2016). Monitoring the athlete training response: subjective self-reported measures trump commonly used objective measures: a systematic review. *British Journal of Sports Medicine* 50(5):281–291. doi:[10.1136/bjsports-2015-094758](https://doi.org/10.1136/bjsports-2015-094758). **Access:** open access (publisher, hybrid). **Local PDF:** no.
  - *Finding:* Systematic review: how athletes feel tracks training load better than blood or heart-rate markers.
  - *Used by:* `learn/deload.ts`, `learn/volume.ts` (low energy as the second signal)
- **Spiering 2021.** Spiering BA, Mujika I, Sharp MA, et al. (2021). Maintaining Physical Performance: The Minimal Dose of Exercise Needed to Preserve Endurance and Strength Over Time. *The Journal of Strength and Conditioning Research* 35(5):1449–1458. doi:[10.1519/jsc.0000000000003964](https://doi.org/10.1519/jsc.0000000000003964). **Access:** paywalled. **Local PDF:** no.
  - *Finding:* Review: strength and size can be kept for months on much less volume if intensity stays.
  - *Used by:* `learn/deload.ts` (a light week costs little); 00-core §5
- **Fry 2001.** Fry AC, Kraemer WJ, Lynch JM, et al. (2001). Overload Injury of the Knees with Resistance-Exercise Overtraining: A Case Study. *Journal of Sport Rehabilitation* 10(1):57–66. doi:[10.1123/jsr.10.1.57](https://doi.org/10.1123/jsr.10.1.57). **Access:** free to read at the publisher (no open licence) ([copy](https://journals.humankinetics.com/downloadpdf/journals/jsr/10/1/article-p57.pdf)). **Local PDF:** no.
  - *Finding:* Two weeks of daily heavy squat overtraining cut the group's squat 1RM by about 9 kg; one lifter developed knee overload injury.
  - *Used by:* `learn/deload.ts` (the size of an overreaching dip)

## Exercise order, selection and rotation

- **Simão 2012.** Simão RF, de Salles BF, de Figueiredo TC, et al. (2012). Exercise Order in Resistance Training. *Sports Medicine* 42(3):251–265. doi:[10.2165/11597240-000000000-00000](https://doi.org/10.2165/11597240-000000000-00000). **Access:** free copy in a repository ([copy](https://thekeep.eiu.edu/kss_fac/33)). **Local PDF:** no.
  - *Finding:* Review: lifts done first get more reps and strength, whatever their muscle size.
  - *Used by:* Item 10 (lift order)
- **Nunes 2021.** Nunes JP, Grgić J, Cunha PM, et al. (2021). What influence does resistance exercise order have on muscular strength gains and muscle hypertrophy? A systematic review and meta‐analysis. *European Journal of Sport Science* 21(2):149–157. doi:[10.1080/17461391.2020.1733672](https://doi.org/10.1080/17461391.2020.1733672). **Access:** paywalled. **Local PDF:** no.
  - *Finding:* Meta-analysis of 11 studies: exercise order did not change hypertrophy; strength favoured the lifts done first.
  - *Used by:* Item 10
- **Spineti 2010.** Spineti J, de Salles BF, Rhea MR, et al. (2010). Influence of Exercise Order on Maximum Strength and Muscle Volume in Nonlinear Periodized Resistance Training. *The Journal of Strength and Conditioning Research* 24(11):2962–2969. doi:[10.1519/jsc.0b013e3181e2e19b](https://doi.org/10.1519/jsc.0b013e3181e2e19b). **Access:** paywalled. **Local PDF:** no.
  - *Finding:* 12-week trial: ordering small-to-large raised the gains of the lifts done first.
  - *Used by:* Item 10
- **Brandão 2020.** Brandão L, Painelli VS, Lasevicius T, et al. (2020). Varying the Order of Combinations of Single- and Multi-Joint Exercises Differentially Affects Resistance Training Adaptations. *The Journal of Strength and Conditioning Research* 34(5):1254–1263. doi:[10.1519/jsc.0000000000003550](https://doi.org/10.1519/jsc.0000000000003550). **Access:** paywalled. **Local PDF:** no.
  - *Finding:* Order of single- and multi-joint lifts shifted which lifts gained most; overall growth was similar.
  - *Used by:* Item 10
- **Trindade 2022.** Trindade TB, Alves RC, de Castro BM, et al. (2022). Pre-exhaustion Training, a Narrative Review of the Acute Responses and Chronic Adaptations. *International journal of exercise science* 15(3):507–525. doi:[10.70252/cevs9112](https://doi.org/10.70252/cevs9112). **Access:** open access (free OA journal). **Local PDF:** no.
  - *Finding:* Narrative review: pre-exhausting a muscle doesn't add growth and costs reps on the compound.
  - *Used by:* Item 10 (pre-exhaustion)
- **Gentil 2007.** Gentil P, Oliveira E, de Araújo Rocha Júnior V, et al. (2007). Effects of Exercise Order on Upper-Body Muscle Activation and Exercise Performance. *The Journal of Strength and Conditioning Research* 21(4):1082. doi:[10.1519/r-21216.1](https://doi.org/10.1519/r-21216.1). **Access:** paywalled (not open access per Europe PMC). **Local PDF:** no.
  - *Finding:* A pec-deck set before the chest press did not raise chest activity in the press, raised triceps activity, and left total reps and work unchanged.
  - *Used by:* Item 10
- **Brennecke 2009.** Brennecke A, Guimarães TM, Leone R, et al. (2009). Neuromuscular Activity During Bench Press Exercise Performed With and Without the Preexhaustion Method. *Journal of Strength and Conditioning Research* 23(7):1933–1940. doi:[10.1519/jsc.0b013e3181b73b8f](https://doi.org/10.1519/jsc.0b013e3181b73b8f). **Access:** paywalled (not open access per Europe PMC). **Local PDF:** no.
  - *Finding:* EMG study: a pec-deck set before the bench raised triceps activity and cut bench reps, without more chest activity.
  - *Used by:* Item 10
- **Soncin 2014.** Soncin R, Pennone J, Guimarães TM, et al. (2014). Influence of Exercise Order on Electromyographic Activity During Upper Body Resistance Training. *Journal of Human Kinetics* 44(1):203–210. doi:[10.2478/hukin-2014-0127](https://doi.org/10.2478/hukin-2014-0127). **Access:** open access (free OA journal) ([copy](https://sciendo.com/pdf/10.2478/hukin-2014-0127)). **Local PDF:** no.
  - *Finding:* Small EMG study of how exercise order shifts muscle activity at fixed volume.
  - *Used by:* Item 10
- **Zhang 2025.** Zhang X, Weakley JJS, Li H, et al. (2025). Superset Versus Traditional Resistance Training Prescriptions: A Systematic Review and Meta-analysis Exploring Acute and Chronic Effects on Mechanical, Metabolic, and Perceptual Variables. *Sports Medicine* 55(4):953–975. doi:[10.1007/s40279-025-02176-8](https://doi.org/10.1007/s40279-025-02176-8). **Access:** open access (publisher, hybrid) ([copy](https://link.springer.com/content/pdf/10.1007/s40279-025-02176-8.pdf)). **Local PDF:** no.
  - *Finding:* Meta-analysis of 19 studies: supersets shorten sessions, lower volume load and raise perceived effort; chronic effects similar.
  - *Used by:* Items 10, 11, 15 (supersets save time and cost some volume load)
- **Kassiano 2022.** Kassiano W, Nunes JP, Costa BDV, et al. (2022). Does Varying Resistance Exercises Promote Superior Muscle Hypertrophy and Strength Gains? A Systematic Review. *The Journal of Strength and Conditioning Research* 36(6):1753–1762. doi:[10.1519/jsc.0000000000004258](https://doi.org/10.1519/jsc.0000000000004258). **Access:** paywalled. **Local PDF:** no.
  - *Finding:* Systematic review: some variation can help regional growth, but excessive rotation hurts gains.
  - *Used by:* `learn/trend.ts`, `rotation.ts` (rotate on a stall, not on a schedule); 00-core §7 (varied exercises and regional hypertrophy); also in ACSM 2026
- **Kassiano 2024.** Kassiano W, Costa BDV, Kunevaliki G, et al. (2024). Muscle Hypertrophy and Strength Adaptations to Systematically Varying Resistance Exercises. *Research Quarterly for Exercise and Sport* 96(2):371–381. doi:[10.1080/02701367.2024.2409961](https://doi.org/10.1080/02701367.2024.2409961). **Access:** paywalled; repository record: [ECU 4912](https://ro.ecu.edu.au/ecuworks2022-2026/4912). **Local PDF:** no.
  - *Finding:* Trial of planned exercise rotation: growth and strength similar to fixed exercises.
  - *Used by:* `learn/trend.ts`; item 12
- **Baz-Valle 2019.** Baz-Valle E, Schoenfeld BJ, Torres-Unda J, et al. (2019). The effects of exercise variation in muscle thickness, maximal strength and motivation in resistance trained men. *PLoS ONE* 14(12):e0226989. doi:[10.1371/journal.pone.0226989](https://doi.org/10.1371/journal.pone.0226989). **Access:** open access (OA journal) ([copy](https://journals.plos.org/plosone/article/file?id=10.1371/journal.pone.0226989&type=printable)). **Local PDF:** no.
  - *Finding:* Trained men: random weekly exercise variation gave similar growth and strength, and more motivation.
  - *Used by:* `learn/trend.ts`; item 12
- **Fonseca 2014.** Fonseca R, Roschel H, Tricoli V, et al. (2014). Changes in Exercises Are More Effective Than in Loading Schemes to Improve Muscle Strength. *The Journal of Strength and Conditioning Research* 28(11):3085–3092. doi:[10.1519/jsc.0000000000000539](https://doi.org/10.1519/jsc.0000000000000539). **Access:** paywalled. **Local PDF:** no.
  - *Finding:* Varying exercises raised strength more than varying load alone; growth was similar.
  - *Used by:* Item 12
- **Costa 2021.** Costa BDV, Kassiano W, Nunes JP, et al. (2021). Does Performing Different Resistance Exercises for the Same Muscle Group Induce Non-homogeneous Hypertrophy? *International Journal of Sports Medicine* 42(09):803–811. doi:[10.1055/a-1308-3674](https://doi.org/10.1055/a-1308-3674). **Access:** paywalled. **Local PDF:** no.
  - *Finding:* Different exercises for the same muscle grew different regions of it.
  - *Used by:* Item 12
- **Rauch 2020.** Rauch JT, Ugrinowitsch C, Barakat C, et al. (2020). Auto-Regulated Exercise Selection Training Regimen Produces Small Increases in Lean Body Mass and Maximal Strength Adaptations in Strength-trained Individuals. *The Journal of Strength and Conditioning Research* 34(4):1133–1140. doi:[10.1519/jsc.0000000000002272](https://doi.org/10.1519/jsc.0000000000002272). **Access:** paywalled. **Local PDF:** no.
  - *Finding:* Lifters who picked exercises by readiness gained similarly to a fixed program.
  - *Used by:* Item 12

## Muscle credit: which muscles a lift trains

- **Mannarino 2021.** Mannarino P, da Matta TT, Lima J, et al. (2021). Single-Joint Exercise Results in Higher Hypertrophy of Elbow Flexors Than Multijoint Exercise. *The Journal of Strength and Conditioning Research* 35(10):2677–2681. doi:[10.1519/jsc.0000000000003234](https://doi.org/10.1519/jsc.0000000000003234). **Access:** paywalled. **Local PDF:** no.
  - *Finding:* Within-person: curls grew the elbow flexors more than rows did.
  - *Used by:* `lifts.ts` (biceps credit from rows); item 13
- **Ogasawara 2012.** Ogasawara R, Thiebaud RS, Loenneke JP, et al. (2012). Time course for arm and chest muscle thickness changes following bench press training. *Interventional Medicine and Applied Science* 4(4):217–220. doi:[10.1556/imas.4.2012.4.7](https://doi.org/10.1556/imas.4.2012.4.7). **Access:** open access (free OA journal) ([copy](https://akjournals.com/downloadpdf/journals/1646/4/4/article-p217.pdf)). **Local PDF:** no.
  - *Finding:* 24 weeks of bench press only: big chest growth, meaningful triceps growth, almost no biceps change.
  - *Used by:* `lifts.ts` (triceps credit from bench); item 13
- **Kubo 2019.** Kubo K, Ikebukuro T, Yata H (2019). Effects of squat training with different depths on lower limb muscle volumes. *European Journal of Applied Physiology* 119(9):1933–1942. doi:[10.1007/s00421-019-04181-y](https://doi.org/10.1007/s00421-019-04181-y). **Access:** paywalled. **Local PDF:** no.
  - *Finding:* MRI trial: full squats grew quads, adductors and glutes; hamstrings barely changed.
  - *Used by:* `lifts.ts` (squats grow adductors and glutes, not hamstrings); item 13
- **Bloomquist 2013.** Bloomquist K, Langberg H, Karlsen SF, et al. (2013). Effect of range of motion in heavy load squatting on muscle and tendon adaptations. *European Journal of Applied Physiology* 113(8):2133–2142. doi:[10.1007/s00421-013-2642-7](https://doi.org/10.1007/s00421-013-2642-7). **Access:** free copy in a repository ([copy](http://hdl.handle.net/11250/218859)). **Local PDF:** no.
  - *Finding:* Deep versus shallow squats: deep squats grew the thigh more; hamstrings changed little.
  - *Used by:* `lifts.ts`; item 13
- **Plotkin 2023.** Plotkin DL, Rodas MA, Vigotsky AD, et al. (2023). Hip thrust and back squat training elicit similar gluteus muscle hypertrophy and transfer similarly to the deadlift. *Frontiers in Physiology* 14:1279170. doi:[10.3389/fphys.2023.1279170](https://doi.org/10.3389/fphys.2023.1279170). **Access:** open access (OA journal) ([copy](https://www.frontiersin.org/articles/10.3389/fphys.2023.1279170/pdf?isPublishedV2=False)). **Local PDF:** no.
  - *Finding:* Hip thrusts and back squats grew the glutes alike; squats grew quads and adductors more.
  - *Used by:* `lifts.ts` (glute credit); item 13
- **Vigotsky 2018.** Vigotsky AD, Halperin I, Lehman GJ, et al. (2018). Interpreting Signal Amplitudes in Surface Electromyography Studies in Sport and Rehabilitation Sciences. *Frontiers in Physiology* 8:985. doi:[10.3389/fphys.2017.00985](https://doi.org/10.3389/fphys.2017.00985). **Access:** open access (OA journal) ([copy](https://www.frontiersin.org/articles/10.3389/fphys.2017.00985/pdf)). **Local PDF:** no.
  - *Finding:* Explains why surface EMG amplitude is hard to compare across exercises.
  - *Used by:* Item 13 (EMG is not growth evidence)
- **Vigotsky 2022.** Vigotsky AD, Halperin I, Trajano GS, et al. (2022). Longing for a Longitudinal Proxy: Acutely Measured Surface EMG Amplitude is not a Validated Predictor of Muscle Hypertrophy. *Sports Medicine* 52(2):193–199. doi:[10.1007/s40279-021-01619-2](https://doi.org/10.1007/s40279-021-01619-2). **Access:** free copy in a repository ([copy](https://link.springer.com/article/10.1007/s40279-021-01619-2)). **Local PDF:** no.
  - *Finding:* Acute EMG amplitude has not been shown to predict long-term muscle growth.
  - *Used by:* `lifts.ts` comment; item 13
- **Spitz 2023.** Spitz RW, Kataoka R, Dankel SJ, et al. (2023). Quantifying the Generality of Strength Adaptation: A Meta-Analysis. *Sports Medicine* 53(3):637–648. doi:[10.1007/s40279-022-01790-0](https://doi.org/10.1007/s40279-022-01790-0). **Access:** paywalled. **Local PDF:** no.
  - *Finding:* Strength gains transfer only partly to untrained movements (about half the trained-lift effect).
  - *Used by:* Item 13
- **Youdas 2010.** Youdas JW, Amundson CL, Cicero KS, et al. (2010). Surface Electromyographic Activation Patterns and Elbow Joint Motion During a Pull-Up, Chin-Up, or Perfect-Pullup™ Rotational Exercise. *The Journal of Strength and Conditioning Research* 24(12):3404–3414. doi:[10.1519/jsc.0b013e3181f1598c](https://doi.org/10.1519/jsc.0b013e3181f1598c). **Access:** paywalled. **Local PDF:** no.
  - *Finding:* EMG of pull-up variants: chin-ups use the biceps more than pull-ups.
  - *Used by:* `lifts.ts` (chin-up biceps credit, EMG-based)
- **Signorile 2002.** Signorile JF, Zink AJ, Szwed SP (2002). A Comparative Electromyographical Investigation of Muscle Utilization Patterns Using Various Hand Positions During the Lat Pull-down. *The Journal of Strength and Conditioning Research* 16(4):539. doi:[10.1519/00124278-200211000-00008](https://doi.org/10.1519/00124278-200211000-00008). **Access:** paywalled. **Local PDF:** no.
  - *Finding:* EMG across pulldown grips: a wide front grip led lat activity.
  - *Used by:* `lifts.ts` (grip and lat pulldown credit, EMG-based)
- **Lusk 2010.** Lusk SJ, Hale BD, Russell DM (2010). Grip Width and Forearm Orientation Effects on Muscle Activity During the Lat Pull-Down. *The Journal of Strength and Conditioning Research* 24(7):1895–1900. doi:[10.1519/jsc.0b013e3181ddb0ab](https://doi.org/10.1519/jsc.0b013e3181ddb0ab). **Access:** paywalled. **Local PDF:** no.
  - *Finding:* EMG on the pulldown: a pronated grip used the lats more than a supinated one; grip width mattered little.
  - *Used by:* `lifts.ts` (pulldown grip, EMG-based)
- **Andersen 2014.** Andersen VS, Fimland MS, Wiik E, et al. (2014). Effects of Grip Width on Muscle Strength and Activation in the Lat Pull-Down. *The Journal of Strength and Conditioning Research* 28(4):1135–1142. doi:[10.1097/jsc.0000000000000232](https://doi.org/10.1097/jsc.0000000000000232). **Access:** paywalled. **Local PDF:** no.
  - *Finding:* Lat pulldown grip width changed strength and lat activity little.
  - *Used by:* `lifts.ts` (pulldown grip, EMG-based)
- **Marchetti & Uchida 2011.** Marchetti PH, Uchida MC (2011). Effects of the Pullover Exercise on the Pectoralis Major and Latissimus Dorsi Muscles as Evaluated by EMG. *Journal of Applied Biomechanics* 27(4):380–384. doi:[10.1123/jab.27.4.380](https://doi.org/10.1123/jab.27.4.380). **Access:** paywalled (not open access per Europe PMC). **Local PDF:** no.
  - *Finding:* EMG: the pullover works the chest more than the lats.
  - *Used by:* `lifts.ts:472` (dumbbell/barbell pullover credits chest over lats)
- **Fisher 2013.** Fisher JP, Bruce-Low S, Smith D (2013). A randomized trial to consider the effect of Romanian deadlift exercise on the development of lumbar extension strength. *Physical Therapy in Sport* 14(3):139–145. doi:[10.1016/j.ptsp.2012.04.001](https://doi.org/10.1016/j.ptsp.2012.04.001). **Access:** paywalled. **Local PDF:** no.
  - *Finding:* Romanian deadlift training raised RDL strength but not isolated lumbar-extension strength.
  - *Used by:* Item 13 (erector credit from hinges)
- **Gentil 2016.** Gentil P, Fisher JP, Steele J (2016). A Review of the Acute Effects and Long-Term Adaptations of Single- and Multi-Joint Exercises during Resistance Training. *Sports Medicine* 47(5):843–855. doi:[10.1007/s40279-016-0627-5](https://doi.org/10.1007/s40279-016-0627-5). **Access:** paywalled. **Local PDF:** no.
  - *Finding:* Review: multi-joint lifts train most muscles, though some (e.g. lumbar extensors) may need direct work.
  - *Used by:* Item 13
- **de França 2015.** França H, Branco PAN, Guedes DP, et al. (2015). The effects of adding single-joint exercises to a multi-joint exercise resistance training program on upper body muscle strength and size in trained men. *Applied Physiology Nutrition and Metabolism* 40(8):822–826. doi:[10.1139/apnm-2015-0109](https://doi.org/10.1139/apnm-2015-0109). **Access:** paywalled. **Local PDF:** no.
  - *Finding:* Adding curls and extensions to a compound-only program added no significant arm growth.
  - *Used by:* Item 13 (arm credit from compounds)
- **Rosa 2023.** Rosa A, Vazquez G, Grgić J, et al. (2023). Hypertrophic Effects of Single- Versus Multi-Joint Exercise of the Limb Muscles: A Systematic Review and Meta-analysis. *Strength and conditioning journal* 45(1):49–57. doi:[10.1519/ssc.0000000000000720](https://doi.org/10.1519/ssc.0000000000000720). **Access:** paywalled. **Local PDF:** no.
  - *Finding:* Meta-analysis of 7 RCTs: single- and multi-joint lifts grew limb muscles similarly.
  - *Used by:* Item 13
- **Buckner 2016.** Buckner SL, Dankel SJ, Mattocks KT, et al. (2016). The problem Of muscle hypertrophy: Revisited. *Muscle & Nerve* 54(6):1012–1014. doi:[10.1002/mus.25420](https://doi.org/10.1002/mus.25420). **Access:** paywalled. **Local PDF:** no.
  - *Finding:* Argues muscle growth and strength gain are only weakly correlated between people.
  - *Used by:* Item 13 (size and strength are loosely linked)
- **Frouin 2024.** Frouin A, le Sant G, Barbier L, et al. (2024). Individual distribution of muscle hypertrophy among hamstring muscle heads: Adding muscle volume where you need is not so simple. *Scandinavian Journal of Medicine and Science in Sports* 34(3):e14608. doi:[10.1111/sms.14608](https://doi.org/10.1111/sms.14608). **Access:** open access (publisher, hybrid) ([copy](https://onlinelibrary.wiley.com/doi/pdfdirect/10.1111/sms.14608)). **Local PDF:** no.
  - *Finding:* Hip-hinge and leg-curl training grew different hamstring muscles.
  - *Used by:* Item 13 (hinges vs curls for the hamstrings)

## Pain and tendon load

- **Silbernagel 2007.** Silbernagel KG, Thomeé R, Eriksson BI, et al. (2007). Continued Sports Activity, Using a Pain-Monitoring Model, during Rehabilitation in Patients with Achilles Tendinopathy. *The American Journal of Sports Medicine* 35(6):897–906. doi:[10.1177/0363546506298279](https://doi.org/10.1177/0363546506298279). **Access:** paywalled. **Local PDF:** no.
  - *Finding:* RCT: Achilles patients who kept training within a pain-monitoring model did as well as those who rested.
  - *Used by:* `painPlan.ts`, `learn/pain.ts`, `learn/volume.ts` (pain up to a set level is acceptable); items 03, 08, 12
- **Silbernagel & Crossley 2015.** Silbernagel KG, Crossley KM (2015). A Proposed Return-to-Sport Program for Patients With Midportion Achilles Tendinopathy: Rationale and Implementation. *Journal of Orthopaedic and Sports Physical Therapy* 45(11):876–886. doi:[10.2519/jospt.2015.5885](https://doi.org/10.2519/jospt.2015.5885). **Access:** paywalled. **Local PDF:** no.
  - *Finding:* Clinical guide to tendon rehab with the pain-monitoring model and its traffic-light zones.
  - *Used by:* `painPlan.ts`, `learn/pain.ts`, `progression.ts` (pain zones 0–2 / 2–5 / >5 out of 10)
- **Smith 2017.** Smith BE, Hendrick P, Smith TO, et al. (2017). Should exercises be painful in the management of chronic musculoskeletal pain? A systematic review and meta-analysis. *British Journal of Sports Medicine* 51(23):1679–1687. doi:[10.1136/bjsports-2016-097383](https://doi.org/10.1136/bjsports-2016-097383). **Access:** open access; free copy: [Nottingham eprints 41764](https://eprints.nottingham.ac.uk/41764/). **Local PDF:** no.
  - *Finding:* Meta-analysis: exercising into some pain gave a small short-term benefit over pain-free exercise.
  - *Used by:* `painPlan.ts`; items 08, 12
- **Smidt 2002.** Smidt N, der Windt D, Assendelft WJ, et al. (2002). Corticosteroid injections, physiotherapy, or a wait-and-see policy for lateral epicondylitis: a randomised controlled trial. *The Lancet* 359(9307):657–662. doi:[10.1016/s0140-6736(02)07811-x](https://doi.org/10.1016/s0140-6736(02)07811-x). **Access:** free copy in a repository ([copy](https://research.vu.nl/en/publications/c46fcbd3-6e6c-42c4-9dc3-1ee684c30627)). **Local PDF:** no.
  - *Finding:* RCT: most tennis-elbow cases resolved within a year under wait-and-see.
  - *Used by:* `learn/pain.ts` (how long elbow pain usually takes to settle)
- **Magnusson 2010.** Magnusson SP, Langberg H, Kjær M (2010). The pathogenesis of tendinopathy: balancing the response to loading. *Nature Reviews Rheumatology* 6(5):262–268. doi:[10.1038/nrrheum.2010.43](https://doi.org/10.1038/nrrheum.2010.43). **Access:** paywalled. **Local PDF:** no.
  - *Finding:* Review: tendon collagen synthesis and breakdown stay raised for days after loading.
  - *Used by:* `painPlan.ts` (check symptoms the next day: collagen turnover runs ~72 h)
- **Karanasios 2021.** Karanasios S, Korakakis V, Whiteley RJ, et al. (2021). Exercise interventions in lateral elbow tendinopathy have better outcomes than passive interventions, but the effects are small: a systematic review and meta-analysis of 2123 subjects in 30 trials. *British Journal of Sports Medicine* 55(9):477–485. doi:[10.1136/bjsports-2020-102525](https://doi.org/10.1136/bjsports-2020-102525). **Access:** paywalled. **Local PDF:** no.
  - *Finding:* Systematic review of 30 RCTs: exercise beats passive care for tennis elbow, with small effects.
  - *Used by:* Item 08
- **Coombes 2016.** Coombes BK, Wiebusch M, Heales L, et al. (2016). Isometric Exercise Above but not Below an Individual’s Pain Threshold Influences Pain Perception in People With Lateral Epicondylalgia. *Clinical Journal of Pain* 32(12):1069–1075. doi:[10.1097/ajp.0000000000000365](https://doi.org/10.1097/ajp.0000000000000365). **Access:** free copy in a repository ([copy](https://figshare.com/articles/journal_contribution/Isometric_exercise_above_but_not_below_an_individual_s_pain_threshold_influences_pain_perception_in_people_With_lateral_epicondylalgia/13394024)). **Local PDF:** no.
  - *Finding:* Isometrics above the pain threshold increased pain in lateral elbow pain.
  - *Used by:* Item 08 (isometrics aren't a pain fix)
- **Rio 2015.** Rio E, Kidgell DJ, Purdam CR, et al. (2015). Isometric exercise induces analgesia and reduces inhibition in patellar tendinopathy. *British Journal of Sports Medicine* 49(19):1277–1283. doi:[10.1136/bjsports-2014-094386](https://doi.org/10.1136/bjsports-2014-094386). **Access:** free to read at the publisher (no open licence) ([copy](https://bjsm.bmj.com/content/bjsports/49/19/1277.full.pdf)). **Local PDF:** no.
  - *Finding:* Early study reporting pain relief from isometrics in patellar tendinopathy; later replications failed.
  - *Used by:* Item 08
- **Riel 2018.** Riel H, Vicenzino B, Jensen MB, et al. (2018). The effect of isometric exercise on pain in individuals with plantar fasciopathy: A randomized crossover trial. *Scandinavian Journal of Medicine &amp; Science in Sports* 28(12):2643–2650. doi:[10.1111/sms.13296](https://doi.org/10.1111/sms.13296). **Access:** paywalled (not open access per Europe PMC). **Local PDF:** no.
  - *Finding:* Crossover trial: isometric exercise gave no more immediate pain relief than other exercise in plantar heel pain.
  - *Used by:* Item 08
- **Silbernagel 2019.** Gravare Silbernagel K, Vicenzino BT, Rathleff MS, et al. (2019). Isometric exercise for acute pain relief: is it relevant in tendinopathy management? *British Journal of Sports Medicine* 53(21):1330–1331. doi:[10.1136/bjsports-2019-100591](https://doi.org/10.1136/bjsports-2019-100591). **Access:** paywalled (not open access per Europe PMC). **Local PDF:** no.
  - *Finding:* Editorial: the evidence for isometrics as instant pain relief in tendon pain is weak.
  - *Used by:* Item 08
- **Clarsen 2013.** Clarsen B, Myklebust G, Bahr R (2013). Development and validation of a new method for the registration of overuse injuries in sports injury epidemiology: the Oslo Sports Trauma Research Centre (OSTRC) Overuse Injury Questionnaire. *British Journal of Sports Medicine* 47(8):495–502. doi:[10.1136/bjsports-2012-091524](https://doi.org/10.1136/bjsports-2012-091524). **Access:** paywalled (not open access per Europe PMC). **Local PDF:** no.
  - *Finding:* The OSTRC overuse questionnaire: most overuse problems show as reduced training or performance, not as time lost, so time-loss registration misses most of them.
  - *Used by:* Item 08 (pain shows up as reduced training)
- **Lowdon 2024.** Lowdon H, Chong HH, Dhingra M, et al. (2024). Comparison of Interventions for Lateral Elbow Tendinopathy: A Systematic Review and Network Meta-Analysis for Patient-Rated Tennis Elbow Evaluation Pain Outcome. *The Journal of Hand Surgery* 49(7):639–648. doi:[10.1016/j.jhsa.2024.03.007](https://doi.org/10.1016/j.jhsa.2024.03.007). **Access:** paywalled (not open access per Europe PMC). **Local PDF:** no.
  - *Finding:* Network meta-analysis of tennis-elbow treatments; none gave fast relief.
  - *Used by:* Item 08 (expect weeks to months)
- **Thomeé 1990s.** Thomeé R. Pain-monitoring model in patellofemoral pain (1990s), as cited in Silbernagel & Crossley 2015 (refs 64, 66, 71). [doi.org](https://doi.org/10.2519/jospt.2015.5885). **Access:** cited via secondary source. **Local PDF:** no.
  - *Finding:* The patellofemoral rehab work where the pain-monitoring model began.
  - *Used by:* Item 08 (origin of the pain-monitoring model)
- **Bahiana patellar review.** Review of patellar tendinopathy rehabilitation protocols (progression criteria). Repositório Bahiana. [repositorio.bahiana.edu.br](https://repositorio.bahiana.edu.br/bitstreams/39fb6762-d754-4aa2-8c84-9fe37bb32337/download). **Access:** free (repository PDF). **Local PDF:** no.
  - *Finding:* Common progression rules across patellar-tendon rehab protocols: tolerable pain, no 24-hour flare, good technique.
  - *Used by:* Item 08 (progress when pain ≤3/10 and not worse in 24 h)

## Warm-ups

- **Ribeiro 2014.** Ribeiro AS, Romanzini M, Schoenfeld BJ, et al. (2014). Effect of Different Warm-up Procedures on the Performance of Resistance Training Exercises. *Perceptual and Motor Skills* 119(1):133–145. doi:[10.2466/25.29.pms.119c17z7](https://doi.org/10.2466/25.29.pms.119c17z7). **Access:** paywalled (not open access per Europe PMC). **Local PDF:** no.
  - *Finding:* Crossover in trained men comparing specific, general and no warm-up before lifting.
  - *Used by:* Item 09
- **Ribeiro 2020.** Ribeiro B, Pereira A, Neves PP, et al. (2020). The Role of Specific Warm-up during Bench Press and Squat Exercises: A Novel Approach. *International Journal of Environmental Research and Public Health* 17(18):6882. doi:[10.3390/ijerph17186882](https://doi.org/10.3390/ijerph17186882). **Access:** open access (OA journal) ([copy](https://www.mdpi.com/1660-4601/17/18/6882/pdf?version=1600738164)). **Local PDF:** no.
  - *Finding:* Trained men: a specific warm-up helped squat and bench performance.
  - *Used by:* Item 09
- **Ribeiro 2021a.** Ribeiro B, et al. (2021). Specific warm-up enhances movement velocity during bench press and squat resistance training. *Journal of Men’s Health*. doi:[10.31083/jomh.2021.069](https://doi.org/10.31083/jomh.2021.069). **Access:** open access (DOAJ-listed journal); DOI matched by title, authors as cited in item 09. **Local PDF:** no.
  - *Finding:* Trained men: specific warm-up sets improved the first working sets.
  - *Used by:* Item 09
- **Ribeiro 2021b.** Ribeiro B, Pereira A, Neves PP, et al. (2021). The effect of warm-up in resistance training and strength performance: a systematic review. *Scientific Repository of Open Access of Portugal (RCAAP)* 17(1):87–94. doi:[10.6063/motricidade.21143](https://doi.org/10.6063/motricidade.21143). **Access:** free copy in a repository ([copy](https://revistas.rcaap.pt/motricidade/article/view/21143)). **Local PDF:** no.
  - *Finding:* Systematic review: a specific warm-up tends to help lifting performance; general warm-ups add little.
  - *Used by:* Item 09
- **Junior 2014.** Junior et al. 2014, warm-up comparison in trained men, as tabulated in Ribeiro 2021 (Motricidade). [revistas.rcaap.pt](https://revistas.rcaap.pt/motricidade/article/view/21143). **Access:** cited via review. **Local PDF:** no.
  - *Finding:* Trained men: several warm-up styles compared on reps at 70% 1RM.
  - *Used by:* Item 09
- **Conrado de Freitas 2018.** Conrado de Freitas et al. 2018, warm-up with heavy singles, as tabulated in Ribeiro 2021 (Motricidade). [revistas.rcaap.pt](https://revistas.rcaap.pt/motricidade/article/view/21143). **Access:** cited via review. **Local PDF:** no.
  - *Finding:* Adding a few heavy warm-up reps to a light warm-up, before bench sets to failure.
  - *Used by:* Item 09
- **Souza 2024.** Souza D, Silva AG, do Vale AF, et al. (2024). Effect of warm-up protocols using lower and higher loads on multiple-set back squat volume-load. *PeerJ* 12:e17347. doi:[10.7717/peerj.17347](https://doi.org/10.7717/peerj.17347). **Access:** open access (OA journal). **Local PDF:** no.
  - *Finding:* Trained men: adding heavier warm-up sets to the usual light ones changed performance little.
  - *Used by:* Item 09
- **Garbisu-Hualde 2023.** Garbisu-Hualde A, Gutierrez L, Santos-Concejero J (2023). Post-Activation Performance Enhancement as a Strategy to Improve Bench Press Performance to Volitional Failure. *Journal of Human Kinetics* 87:199–206. doi:[10.5114/jhk/162958](https://doi.org/10.5114/jhk/162958). **Access:** open access (free OA journal) ([copy](https://jhk.termedia.pl/pdf-162958-90546?filename=Post_Activation.pdf)). **Local PDF:** no.
  - *Finding:* A single heavy warm-up rep at about 93% 1RM before work sets, in trained men.
  - *Used by:* Item 09
- **Fradkin 2010.** Fradkin AJ, Zazryn T, Smoliga JM (2010). Effects of Warming-up on Physical Performance: A Systematic Review With Meta-analysis. *The Journal of Strength and Conditioning Research* 24(1):140–148. doi:[10.1519/jsc.0b013e3181c643a0](https://doi.org/10.1519/jsc.0b013e3181c643a0). **Access:** paywalled. **Local PDF:** no.
  - *Finding:* Systematic review: warming up improved performance in most criteria across sports, with little sign of harm.
  - *Used by:* Item 09
- **Bishop 2003.** Bishop D (2003). Warm Up I. *Sports Medicine* 33(6):439–454. doi:[10.2165/00007256-200333060-00005](https://doi.org/10.2165/00007256-200333060-00005). **Access:** paywalled (not open access per Europe PMC). **Local PDF:** no.
  - *Finding:* Review of warm-up physiology: muscle temperature rises fast and falls within about 15–30 min.
  - *Used by:* 00-core §1 (warmth fades within 15–30 min)
- **Abbud, Nader, Gil, Foganholi, Brandenburg.** Abbud 2013, Nader 2009, Gil 2016, Foganholi 2012, Brandenburg 2005: small warm-up trials as tabulated in Ribeiro 2021 (Motricidade). [revistas.rcaap.pt](https://revistas.rcaap.pt/motricidade/article/view/21143). **Access:** cited via review. **Local PDF:** no.
  - *Finding:* Small trials of light general or specific warm-ups before 1RM or rep tests.
  - *Used by:* Item 09
- **Warm-up evidence summary (NBK72912).** Database of Abstracts of Reviews of Effects summary of warm-up and injury-prevention evidence. NCBI Bookshelf NBK72912. [www.ncbi.nlm.nih.gov](https://www.ncbi.nlm.nih.gov/books/NBK72912/). **Access:** free. **Local PDF:** no.
  - *Finding:* Appraisal of review evidence on warm-ups: injury prevention unclear but leaning favourable.
  - *Used by:* Item 09
- **Raccuglia 2015.** Raccuglia M, Lloyd AB, Filingeri D, et al. (2015). Post-warm-up muscle temperature maintenance: blood flow contribution and external heating optimisation. *European Journal of Applied Physiology* 116(2):395–404. doi:[10.1007/s00421-015-3294-6](https://doi.org/10.1007/s00421-015-3294-6). **Access:** open access (publisher, hybrid) ([copy](https://link.springer.com/content/pdf/10.1007%2Fs00421-015-3294-6.pdf)). **Local PDF:** no.
  - *Finding:* Muscle temperature rises within minutes of exercise and decays over the following 15–30 min.
  - *Used by:* Item 09 ("already warm" expires)

## Session length

- **Schoenfeld 2015.** Schoenfeld BJ, Ogborn DI, Krieger JW (2015). Effect of Repetition Duration During Resistance Training on Muscle Hypertrophy: A Systematic Review and Meta-Analysis. *Sports Medicine* 45(4):577–585. doi:[10.1007/s40279-015-0304-0](https://doi.org/10.1007/s40279-015-0304-0). **Access:** paywalled. **Local PDF:** no.
  - *Finding:* Meta-analysis: reps lasting 0.5–8 s give similar growth, so a 10-rep set takes 20–40 s.
  - *Used by:* `timing.ts:89-92` `SET_WORK = 40` s; item 11; also in ACSM 2026
- **Andersen 2022.** Andersen VS, Fimland MS, Iversen VM, et al. (2022). A Comparison of Affective Responses Between Time Efficient and Traditional Resistance Training. *Frontiers in Psychology* 13:912368. doi:[10.3389/fpsyg.2022.912368](https://doi.org/10.3389/fpsyg.2022.912368). **Access:** open access (OA journal) ([copy](https://www.frontiersin.org/articles/10.3389/fpsyg.2022.912368/pdf)). **Local PDF:** no.
  - *Finding:* Crossover: a traditional session took about two-thirds longer than a paired-set one for slightly more volume.
  - *Used by:* Item 11

## Bodyweight lifts and body-weight noise

- **Ebben 2011.** Ebben WP, et al. Kinetic analysis of several variations of push-ups. ISBS Conference Proceedings Archive; 2011. [ojs.ub.uni-konstanz.de](https://ojs.ub.uni-konstanz.de/cpa/article/view/4457). **Access:** free (conference abstract). **Local PDF:** no.
  - *Finding:* Force-plate data on push-up variants: a standard push-up loads about two-thirds of body weight.
  - *Used by:* `learn/bodyweight.ts` (a push-up lifts about 0.64 of body weight)
- **Winter 2009.** Winter DA. Biomechanics and Motor Control of Human Movement. 4th ed. Hoboken, NJ: Wiley; 2009. Table 4.1. [doi.org](https://doi.org/10.1002/9780470549148). **Access:** book (paywalled). **Local PDF:** no.
  - *Finding:* Standard table of body-segment mass fractions.
  - *Used by:* `learn/bodyweight.ts` (segment masses for dips and pull-ups)
- **Suprak 2011.** Suprak DN, Dawes JJ, Stephenson MD (2011). The Effect of Position on the Percentage of Body Mass Supported During Traditional and Modified Push-up Variants. *The Journal of Strength and Conditioning Research* 25(2):497–503. doi:[10.1519/jsc.0b013e3181bde2cf](https://doi.org/10.1519/jsc.0b013e3181bde2cf). **Access:** free copy in a repository ([copy](https://arca.fiocruz.br/handle/icict/63607)). **Local PDF:** no.
  - *Finding:* Push-up load changes with hand and body position; knee push-ups load much less.
  - *Used by:* `learn/bodyweight.ts`; item 14
- **Kotarsky 2018.** Kotarsky CJ, Christensen BK, Miller JS, et al. (2018). Effect of Progressive Calisthenic Push-up Training on Muscle Strength and Thickness. *The Journal of Strength and Conditioning Research* 32(3):651–659. doi:[10.1519/jsc.0000000000002345](https://doi.org/10.1519/jsc.0000000000002345). **Access:** paywalled. **Local PDF:** no.
  - *Finding:* Push-up training progressed by load matched bench-press gains over 4 weeks.
  - *Used by:* Item 14 (load matters, not the implement)
- **Calatayud 2015.** Calatayud J, Borreani S, Colado JC, et al. (2015). Bench Press and Push-up at Comparable Levels of Muscle Activity Results in Similar Strength Gains. *The Journal of Strength and Conditioning Research* 29(1):246–253. doi:[10.1519/jsc.0000000000000589](https://doi.org/10.1519/jsc.0000000000000589). **Access:** free copy in a repository ([copy](https://roderic.uv.es/bitstreams/9b37d667-9048-4ecb-81de-33572f0f9d02/download)). **Local PDF:** no.
  - *Finding:* Band-loaded push-ups at a 6RM load matched bench press at 6RM over 5 weeks.
  - *Used by:* Item 14
- **Sánchez-Moreno 2017.** Sánchez-Moreno M, Rodríguez-Rosell D, Pareja-Blanco F, et al. (2017). Movement Velocity as Indicator of Relative Intensity and Level of Effort Attained During the Set in Pull-Up Exercise. *International Journal of Sports Physiology and Performance* 12(10):1378–1384. doi:[10.1123/ijspp.2016-0791](https://doi.org/10.1123/ijspp.2016-0791). **Access:** free copy in a repository ([copy](https://rio.upo.es/bitstreams/b284ba7e-24e1-44af-b7f3-f32a4a8afa4b/download)). **Local PDF:** no.
  - *Finding:* Pull-up velocity tracks relative intensity and effort, treating body weight plus added load as the load.
  - *Used by:* Item 14
- **Muñoz-López 2017.** Muñoz-López M, Marchante D, Cano-Ruiz MA, et al. (2017). Load-, Force-, and Power-Velocity Relationships in the Prone Pull-Up Exercise. *International Journal of Sports Physiology and Performance* 12(9):1249–1255. doi:[10.1123/ijspp.2016-0657](https://doi.org/10.1123/ijspp.2016-0657). **Access:** paywalled. **Local PDF:** no.
  - *Finding:* Load-velocity profiles for pull-ups using system mass (body plus added weight).
  - *Used by:* Item 14
- **Body-weight change (Br J Nutr 1964).** Measurement of change in body weight. Br J Nutr. 1964 (Cambridge Core). [www.cambridge.org](https://www.cambridge.org/core/services/aop-cambridge-core/content/view/4E78A0DB251133BEF39D73EB50C2F8A2/S0007114564000228a.pdf/div-class-title-measurement-of-change-in-body-weight-div.pdf). **Access:** free (publisher PDF). **Local PDF:** no.
  - *Finding:* Classic data on how much body weight swings day to day and with time of day.
  - *Used by:* Item 14 (day-to-day weight noise)
- **Short-term weight fluctuation (older inpatients).** Short-term body weight fluctuations in older well-hydrated hospitalised patients. Bond University research portal. [research.bond.edu.au](https://research.bond.edu.au/en/publications/short-term-body-weight-fluctuations-in-older-well-hydrated-hospit/). **Access:** abstract free. **Local PDF:** no.
  - *Finding:* Weighed at the same time of day, body weight varied by about 0.4 kg or less.
  - *Used by:* Item 14
- **Day-to-day weight variance (J Obes 2010).** Within-person day-to-day body weight variation. J Obes. 2010 (DOAJ record). [doaj.org](https://doaj.org/article/61509f46f7bf4d358835ac35931ca411). **Access:** open access. **Local PDF:** no.
  - *Finding:* Day-to-day swings are under 1% of body weight within a person.
  - *Used by:* Item 14

## Supersets and splitting a session's gaps

- **Maia 2014.** Maia MF, Willardson JM, Paz GA, et al. (2014). Effects of Different Rest Intervals Between Antagonist Paired Sets on Repetition Performance and Muscle Activation. *The Journal of Strength and Conditioning Research* 28(9):2529–2535. doi:[10.1519/jsc.0000000000000451](https://doi.org/10.1519/jsc.0000000000000451). **Access:** free copy in a repository ([copy](https://thekeep.eiu.edu/kss_fac/27)). **Local PDF:** no.
  - *Finding:* Antagonist paired sets with 0 to 5 min between them: short gaps cut reps.
  - *Used by:* Item 15
- **Behenck 2022.** Behenck C, Sant'Ana H, de Castro JBP, et al. (2022). The Effect of Different Rest Intervals Between Agonist-Antagonist Paired Sets on Training Performance and Efficiency. *The Journal of Strength and Conditioning Research* 36(3):781–786. doi:[10.1519/jsc.0000000000003648](https://doi.org/10.1519/jsc.0000000000003648). **Access:** paywalled. **Local PDF:** no.
  - *Finding:* Rest between agonist–antagonist pairs of 1–2 min preserved performance.
  - *Used by:* Item 15 (2:00 between superset rounds)
- **Ibbott 2019.** Ibbott P, Ball NB, Welvaert M, et al. (2019). The Effect of Self-Paced and Prescribed Interset Rest Strategies on Performance in Strength Training. *International Journal of Sports Physiology and Performance* 14(7):980–986. doi:[10.1123/ijspp.2018-0480](https://doi.org/10.1123/ijspp.2018-0480). **Access:** paywalled. **Local PDF:** no.
  - *Finding:* Trained lifters choosing their own rest took longer as sets went on.
  - *Used by:* Item 15 (self-chosen rest lengthens across sets)
- **Ibbott (reliability).** Ibbott P, et al. Companion reliability paper on self-selected rest, Perceptual and Motor Skills (LIDA record 4059322). [lida.sport-iat.de](https://lida.sport-iat.de/ta/Record/4059322?lng=en). **Access:** abstract free. **Local PDF:** no.
  - *Finding:* Self-selected rest periods were reasonably reproducible within a lifter.
  - *Used by:* Item 15
- **Halfaker 2015.** Halfaker A, Keyes O, Kluver D, et al. User session identification based on strong regularities in inter-activity time. WWW 2015. arXiv:1411.2878. [arxiv.org](https://arxiv.org/abs/1411.2878). **Access:** open (preprint). **Local PDF:** no.
  - *Finding:* Inter-activity times form two clusters, which gives a principled cut between switches and breaks.
  - *Used by:* Item 15 (gaps split into within- and between-session)
- **Fraley & Raftery 2007.** Fraley C, Raftery AE (2007). Bayesian Regularization for Normal Mixture Estimation and Model-Based Clustering. *Journal of Classification* 24(2):155–181. doi:[10.1007/s00357-007-0004-5](https://doi.org/10.1007/s00357-007-0004-5). **Access:** paywalled. **Local PDF:** no.
  - *Finding:* Bayesian regularization for normal mixtures, avoiding degenerate fits.
  - *Used by:* Item 15 (mixture fits)
- **Wald 1945.** Wald A (1945). Sequential Tests of Statistical Hypotheses. *The Annals of Mathematical Statistics* 16(2):117–186. doi:[10.1214/aoms/1177731118](https://doi.org/10.1214/aoms/1177731118). **Access:** free to read at the publisher (no open licence) ([copy](https://projecteuclid.org/journals/annals-of-mathematical-statistics/volume-16/issue-2/Sequential-Tests-of-Statistical-Hypotheses/10.1214/aoms/1177731118.pdf)). **Local PDF:** no.
  - *Finding:* The sequential probability ratio test: add log-likelihood ratios until a threshold is crossed.
  - *Used by:* Item 15 (sequential test for supersets)
- **Barron 2020.** Barron. Mixture models for gap thresholds. arXiv:2007.07350; 2020. [arxiv.org](https://arxiv.org/abs/2007.07350). **Access:** open (preprint). **Local PDF:** no.
  - *Finding:* Mixture-model thresholds for splitting gaps; nothing beyond the mixture view.
  - *Used by:* Item 15
- **Mehrotra/assistant logs (WWW 2017).** Microsoft Research. Task and session identification in assistant logs. WWW 2017. [www.microsoft.com](https://www.microsoft.com/en-us/research/?p=376994). **Access:** free. **Local PDF:** no.
  - *Finding:* Separates short task-switch gaps from longer breaks in interaction logs.
  - *Used by:* Item 15 (template: switch gaps vs rest gaps)
- **Burst detection review.** Review of burst-detection methods (Kleinberg-type models). arXiv:1802.01287. [arxiv.org](https://arxiv.org/pdf/1802.01287). **Access:** open (preprint). **Local PDF:** no.
  - *Finding:* Survey of methods that find bursts of activity in event streams.
  - *Used by:* Item 15 (considered, not used)

## Reminders and habit formation

- **Beshears 2021.** Beshears JL, Lee HN, Milkman KL, et al. (2021). Creating Exercise Habits Using Incentives: The Trade-off Between Flexibility and Routinization. *Management Science* 67(7):4139–4171. doi:[10.1287/mnsc.2020.3706](https://doi.org/10.1287/mnsc.2020.3706). **Access:** free copy in a repository ([copy](https://www.ncbi.nlm.nih.gov/pmc/articles/8734590)). **Local PDF:** no.
  - *Finding:* Field experiment: rewarding a fixed daily gym time built less of a habit than rewarding any time.
  - *Used by:* `learn/remind.ts` (flexible timing; a reminder before every session)
- **Stawarz 2015.** Stawarz K, Cox AL, Blandford A. Beyond self-tracking and reminders: designing smartphone apps that support habit formation. CHI 2015. [discovery.ucl.ac.uk](https://discovery.ucl.ac.uk/id/eprint/1468224/). **Access:** open (repository). **Local PDF:** no.
  - *Finding:* Reminders help a behaviour repeat but can stop a habit forming; event cues work better.
  - *Used by:* `learn/remind.ts`
- **Klasnja 2019.** Klasnja P, Smith SN, Seewald NJ, et al. (2019). Efficacy of Contextually Tailored Suggestions for Physical Activity: A Micro-randomized Optimization Trial of HeartSteps. *Annals of Behavioral Medicine* 53(6):573–582. doi:[10.1093/abm/kay067](https://doi.org/10.1093/abm/kay067). **Access:** free copy in a repository ([copy](https://www.ncbi.nlm.nih.gov/pmc/articles/6401341)). **Local PDF:** no.
  - *Finding:* Micro-randomized trial: activity prompts raised steps briefly, fading after 2–4 weeks.
  - *Used by:* `learn/remind.ts`
- **Lally 2010.** Lally PJ, van Jaarsveld CHM, Potts HWW, et al. (2010). How are habits formed: Modelling habit formation in the real world. *European Journal of Social Psychology* 40(6):998–1009. doi:[10.1002/ejsp.674](https://doi.org/10.1002/ejsp.674). **Access:** free to read at the publisher (no open licence) ([copy](https://onlinelibrary.wiley.com/doi/pdfdirect/10.1002/ejsp.674)). **Local PDF:** no.
  - *Finding:* Habits took a median of about 66 days to form; a missed day did not matter much.
  - *Used by:* `learn/remind.ts` (one missed day doesn't break a habit)
- **Nahum-Shani 2018.** Nahum-Shani IB, Smith SN, Spring BJ, et al. (2018). Just-in-Time Adaptive Interventions (JITAIs) in Mobile Health: Key Components and Design Principles for Ongoing Health Behavior Support. *Annals of Behavioral Medicine* 52(6):446–462. doi:[10.1007/s12160-016-9830-8](https://doi.org/10.1007/s12160-016-9830-8). **Access:** open access (publisher, hybrid) ([copy](https://academic.oup.com/abm/article-pdf/52/6/446/31574391/s12160-016-9830-8.pdf)). **Local PDF:** no.
  - *Finding:* Framework for just-in-time adaptive interventions: support when needed and when the person is available.
  - *Used by:* `learn/remind.ts`, `worker/src/userbox.ts` (nudge only when it can help)
- **Perski 2021.** Perski O, et al. Review of just-in-time adaptive interventions (UCL Discovery 10133803); 2021. [discovery.ucl.ac.uk](https://discovery.ucl.ac.uk/id/eprint/10133803/). **Access:** open (repository). **Local PDF:** no.
  - *Finding:* Summary of how adaptive nudges are timed in health apps.
  - *Used by:* Item 16
- **Milkman 2021.** Milkman KL, Gromet DM, Ho H, et al. (2021). Megastudies improve the impact of applied behavioural science. *Nature* 600(7889):478–483. doi:[10.1038/s41586-021-04128-4](https://doi.org/10.1038/s41586-021-04128-4). **Access:** free copy in a repository ([copy](https://www.ncbi.nlm.nih.gov/pmc/articles/8822539)). **Local PDF:** no.
  - *Finding:* Megastudy of 54 gym-visit nudges: many worked during the program; few lasted after 4 weeks.
  - *Used by:* Item 16
- **Bidargaddi 2018.** Bidargaddi NP, Almirall D, Murphy SA, et al. (2018). To Prompt or Not to Prompt? A Microrandomized Trial of Time-Varying Push Notifications to Increase Proximal Engagement With a Mobile Health App. *JMIR mhealth and uhealth* 6(11):e10123. doi:[10.2196/10123](https://doi.org/10.2196/10123). **Access:** open access (OA journal). **Local PDF:** no.
  - *Finding:* Micro-randomized trial: prompts at certain times of day lifted engagement slightly.
  - *Used by:* Item 16 (time-of-day nudges)
- **Bell 2023 (Drink Less).** Bell L, Garnett CV, Bao Y, et al. (2023). How Notifications Affect Engagement With a Behavior Change App: Results From a Micro-Randomized Trial. *JMIR mhealth and uhealth* 11:e38342. doi:[10.2196/38342](https://doi.org/10.2196/38342). **Access:** open access (OA journal) ([copy](https://jmir.org/api/download?alt_name=mhealth_v11i1e38342_app7.pdf&filename=a9def8556e49bd6dddd14c2300dee171.pdf)). **Local PDF:** no.
  - *Finding:* Micro-randomized trial of notification timing and content in an alcohol-reduction app.
  - *Used by:* Item 16
- **Bélanger-Gravel 2013.** Bélanger-Gravel A, Godin G, Amireault S (2013). A meta-analytic review of the effect of implementation intentions on physical activity. *Health Psychology Review* 7(1):23–54. doi:[10.1080/17437199.2011.560095](https://doi.org/10.1080/17437199.2011.560095). **Access:** paywalled. **Local PDF:** no.
  - *Finding:* Meta-analysis: planning when and where to exercise has a small effect on activity.
  - *Used by:* Item 16
- **Kaushal & Rhodes 2015.** Kaushal N, Rhodes RE (2015). Exercise habit formation in new gym members: a longitudinal study. *Journal of Behavioral Medicine* 38(4):652–663. doi:[10.1007/s10865-015-9640-7](https://doi.org/10.1007/s10865-015-9640-7). **Access:** paywalled. **Local PDF:** no.
  - *Finding:* New gym members needed about four sessions a week for six weeks to form a habit.
  - *Used by:* Item 16
- **Schumacher 2019.** Schumacher LM, Thomas JG, Raynor HA, et al. (2019). Relationship of Consistency in Timing of Exercise Performance and Exercise Levels Among Successful Weight Loss Maintainers. *Obesity* 27(8):1285–1291. doi:[10.1002/oby.22535](https://doi.org/10.1002/oby.22535). **Access:** paywalled (not open access per Europe PMC). **Local PDF:** no.
  - *Finding:* Weight-loss maintainers who exercised at a consistent time did more activity.
  - *Used by:* Item 16

## Body weight change and protein

- **Iraki 2019.** Iraki J, Fitschen PJ, Espinar S, et al. (2019). Nutrition Recommendations for Bodybuilders in the Off-Season: A Narrative Review. *Sports* 7(7):154. doi:[10.3390/sports7070154](https://doi.org/10.3390/sports7070154). **Access:** open access (OA journal) ([copy](https://www.mdpi.com/2075-4663/7/7/154/pdf?version=1561541344)). **Local PDF:** no.
  - *Finding:* Off-season bodybuilding nutrition review: a slow weekly gain limits fat.
  - *Used by:* `body.ts:144` (lean-gain band 0.25–0.5% a week)
- **Helms 2014.** Helms ER, Aragon AA, Fitschen PJ (2014). Evidence-based recommendations for natural bodybuilding contest preparation: nutrition and supplementation. *Journal of the International Society of Sports Nutrition* 11(1):20. doi:[10.1186/1550-2783-11-20](https://doi.org/10.1186/1550-2783-11-20). **Access:** open access (OA journal) ([copy](https://www.tandfonline.com/doi/pdf/10.1186/1550-2783-11-20?needAccess=true)). **Local PDF:** no.
  - *Finding:* Contest-prep review: lose about 0.5–1% of body weight a week to keep muscle.
  - *Used by:* `body.ts:144` (cutting band 0.5–1% a week)
- **Morton 2018.** Morton RW, Murphy KT, McKellar SR, et al. (2018). A systematic review, meta-analysis and meta-regression of the effect of protein supplementation on resistance training-induced gains in muscle mass and strength in healthy adults. *British Journal of Sports Medicine* 52(6):376–384. doi:[10.1136/bjsports-2017-097608](https://doi.org/10.1136/bjsports-2017-097608). **Access:** open access (publisher, hybrid) ([copy](https://bjsm.bmj.com/content/bjsports/52/6/376.full.pdf)). **Local PDF:** no.
  - *Finding:* Meta-analysis: protein beyond about 1.6 g/kg a day added no further muscle gain.
  - *Used by:* `body.ts:153` (protein 1.6 g/kg a day)

## Statistical methods

- **Kalman 1960.** Kalman RE (1960). A New Approach to Linear Filtering and Prediction Problems. *Journal of Basic Engineering* 82(1):35–45. doi:[10.1115/1.3662552](https://doi.org/10.1115/1.3662552). **Access:** paywalled. **Local PDF:** no.
  - *Finding:* The original linear filtering and prediction method.
  - *Used by:* `learn/capacity.ts` (two-pass Kalman levels)
- **Sheppard 1898.** Sheppard WF. On the calculation of the most probable values of frequency-constants, for data arranged according to equidistant division of a scale. Proc Lond Math Soc. 1898;29:353–380. [doi.org](https://doi.org/10.1112/plms/s1-29.1.353). **Access:** public domain (age). **Local PDF:** no.
  - *Finding:* Rounding to whole units adds an error with SD 1/√12 of a unit.
  - *Used by:* `learn/rest.ts` (δ = 1/√12 rep)
- **Tukey 1977.** Tukey JW. Exploratory Data Analysis. Reading, MA: Addison-Wesley; 1977. [archive.org](https://archive.org/details/exploratorydataa00tuke_0). **Access:** book. **Local PDF:** no.
  - *Finding:* The boxplot fence for flagging outliers.
  - *Used by:* `learn/capacity.ts`, `learn/session.ts` (outlier fence Q3 + 1.5·IQR)
- **Searle 1971.** Searle SR. Linear Models. New York: Wiley; 1971. [doi.org](https://doi.org/10.1002/9781118491782). **Access:** book (paywalled). **Local PDF:** no.
  - *Finding:* Variance-component estimates for unbalanced one-way designs.
  - *Used by:* `learn/session.ts` (unbalanced ANOVA variance components)
- **Kass & Wasserman 1995.** Kass RE, Wasserman L (1995). A Reference Bayesian Test for Nested Hypotheses and its Relationship to the Schwarz Criterion. *Journal of the American Statistical Association* 90(431):928. doi:[10.1080/01621459.1995.10476592](https://doi.org/10.1080/01621459.1995.10476592). **Access:** paywalled. **Local PDF:** no.
  - *Finding:* A reference Bayes test linking the unit-information prior to BIC.
  - *Used by:* `learn/session.ts` (unit-information g-prior)
- **Duan 1983.** Duan N (1983). Smearing Estimate: A Nonparametric Retransformation Method. *Journal of the American Statistical Association* 78(383):605. doi:[10.1080/01621459.1983.10478017](https://doi.org/10.1080/01621459.1983.10478017). **Access:** paywalled. **Local PDF:** no.
  - *Finding:* Smearing estimator: unbiased predictions on the original scale after a log-scale fit.
  - *Used by:* `learn/session.ts` (smearing back from logs)
- **Ibrahim & Chen 2000.** Ibrahim JG, Chen MH (2000). Power prior distributions for regression models. *Statistical Science* 15(1):46–60. doi:[10.1214/ss/1009212673](https://doi.org/10.1214/ss/1009212673). **Access:** free to read at the publisher (no open licence) ([copy](https://projecteuclid.org/journals/statistical-science/volume-15/issue-1/Power-prior-distributions-for-regression-models/10.1214/ss/1009212673.pdf)). **Local PDF:** no.
  - *Finding:* Power priors: discount historical data by raising its likelihood to a power.
  - *Used by:* `learn/session.ts`, `learn/remind.ts` (down-weighting old data)
- **Silverman 1986.** Silverman BW. Density Estimation for Statistics and Data Analysis. London: Chapman & Hall; 1986. eq. 3.31. [doi.org](https://doi.org/10.1201/9781315140919). **Access:** book. **Local PDF:** no.
  - *Finding:* Rule-of-thumb bandwidth for kernel density estimates.
  - *Used by:* `learn/remind.ts` (kernel bandwidth rule)
- **Mardia 1972.** Mardia KV. Statistics of Directional Data. London: Academic Press; 1972. [docs.scipy.org](https://docs.scipy.org/doc/scipy-1.12.0/reference/generated/scipy.stats.circstd.html). **Access:** book. **Local PDF:** no.
  - *Finding:* Circular statistics: the circular standard deviation √(−2 ln R).
  - *Used by:* Item 16 (circular SD of reminder times)
- **Theil–Sen.** Sen PK (1968). Estimates of the Regression Coefficient Based on Kendall's Tau. *Journal of the American Statistical Association* 63(324):1379. doi:[10.1080/01621459.1968.10480934](https://doi.org/10.1080/01621459.1968.10480934). **Access:** paywalled. **Local PDF:** no.
  - *Finding:* Sen 1968: the median of pairwise slopes, a robust trend estimate (with Theil 1950).
  - *Used by:* Item 12 (proposed robust slope; `learn/trend.ts` ships a weighted least-squares slope instead)
- **Armstrong 2022.** Armstrong TB, Kolesár M, Plagborg-Møller M. Robust empirical Bayes confidence intervals. Econometrica. 2022;90(6):2567–2602. arXiv:2004.03448. [arxiv.org](https://arxiv.org/pdf/2004.03448v2). **Access:** open (preprint). **Local PDF:** no.
  - *Finding:* Confidence intervals for shrunken estimates that keep their coverage.
  - *Used by:* Item 11 (empirical Bayes intervals)
## Lay, industry and tool references

These are not research evidence. They were used for context, for product conventions, or to explain a method. None is a reason the app takes an action.

| Reference | Link | Used in | For |
|---|---|---|---|
| ACSM press release, infographic and slide deck (2026) | [acsm.org](https://acsm.org/science-spotlight-acsm-releases-new-position-stand-on-resistance-training/) | This library | Lay summary of the 2026 stand (local copies kept privately) |
| NHS: tennis elbow | [nhs.uk](https://www.nhs.uk/conditions/tennis-elbow/) | `painPlan.ts` `NHS_DAYS = 14`, `CareCard.tsx` | See a GP if pain persists after 2 weeks of self-care |
| FDA general wellness guidance (Jan 2026), law-firm summaries | [Covington](https://cov.com/en/news-and-insights/insights/2026/01/fda-issues-revised-guidance-on-general-wellness-products), [Troutman](https://troutman.com/insights/fdas-2026-guidance-on-general-wellness-devices-policy-for-low-risk-devices) | Item 08 | Why pain features avoid diagnosis or treatment claims |
| Barbell Medicine (Baraki 2025), E3 Rehab, Hinge Health, Physiotutors, Physical Therapy First | [barbellmedicine.com](https://www.barbellmedicine.com/blog/lifting-rehab-mistakes/), [e3rehab.com](https://e3rehab.com/blog/how-to-train-around-pain-or-injuries/) | Item 08 | Clinician coaching on training around pain |
| Stronger By Science articles (load progression, overload, reps–%1RM, hypertrophy range, detraining, RIR, warm-ups, squat depth and adductors) | [strongerbyscience.com](https://www.strongerbyscience.com/) | Items 01–05, 09, 13 | Secondary summaries of the studies listed above |
| MacroFactor, RP Strength, Alpha Progression, Biolayne, BOXROX, T3, Weekly Flex, BarBend, StrengthLog | various | Items 04, 07, 09, 12, 13 | Coaching opinion and app conventions (expert opinion only) |
| Fitbod, Hevy help centre | [fitbod](https://help.fitbod.me/hc/en-us/articles/360004429814-How-Fitbod-Creates-Your-Workout), [hevy](https://help.hevyapp.com/) | Items 11, 14, 15 | How other apps time workouts, count bodyweight and assisted sets, and group supersets |
| Equipment pages (RitFit, Torque adder pin, BodyCraft add-on weight) | [torquefitness.com](https://www.torquefitness.com/products/weight-stack-adder-pin) | Item 01 | Real cable and stack increments |
| Pull-up calculators (Fitness Volt, This Is Why I'm Fit), BullBarFit, Breaking Muscle, push-up biomechanics review | various | Item 14 | Cross-checks of bodyweight fractions |
| Duarte BMC notebook, Visual3D wiki | [nbviewer](https://nbviewer.jupyter.org/github/demotu/BMC/blob/master/notebooks/BodySegmentParameters.ipynb) | Item 14 | Segment-mass tables (Dempster, Winter) |
| Planning-fallacy summaries (PMI, Cranfield), empirical-Bayes calculator | [pmi.org](https://www.pmi.org/learning/library/planning-fallacy-causes-solutions-project-expectations-6374) | Item 11 | Why session forecasts run short |
| SciPy `circstd`, Astropy circstats, CRAN `bursts` | [scipy](https://docs.scipy.org/doc/scipy-1.12.0/reference/generated/scipy.stats.circstd.html) | Items 15, 16 | Reference implementations of the methods above |
| Robust linear forecasting overview (Theil–Sen) | [epwales.org.uk](https://epwales.org.uk/wp-content/uploads/2023/07/2.2.2-Amanda-Clare-Robust-linear-forecasting-of-trends-EPW.pdf) | Item 12 | Theil–Sen explained |
| Habit and nudge summaries (HBS, Penn Today, UCL news, ScienceAlert, Healio) | various | Item 16 | Lay write-ups of Beshears 2021, Milkman 2021, Lally 2010 and Schumacher 2019 |
| Wikipedia: one-repetition maximum | [wikipedia](https://en.wikipedia.org/wiki/One-repetition_maximum) | Item 05 | Overview of 1RM formulas |
