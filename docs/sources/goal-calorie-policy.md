# Automatic calorie-goal policy source

NutriTrack keeps the weight-goal arithmetic separate from the rule that decides whether an automatically calculated calorie target may be applied.

The current automatic lower bound is **1000 kcal/day**. This mirrors the behavior of the NIH/NIDDK Body Weight Planner, which rejects calorie goals below 1000 kcal/day rather than silently clamping them to a plausible-looking target:

- NIH/NIDDK Body Weight Planner: https://www.niddk.nih.gov/bwp
- About the Body Weight Planner: https://www.niddk.nih.gov/health-information/weight-management/body-weight-planner

The NIDDK planner states that its information is intended for adults and is not medical advice. NutriTrack therefore treats 1000 kcal/day as a conservative **product rule for automatic application**, not as a universal individualized safety threshold.

The upper automatic bound of **10000 kcal/day** is an application/storage range limit, not a health recommendation.

If either bound changes, update the policy constants/tests and this source note together.