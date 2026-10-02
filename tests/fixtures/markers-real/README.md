# Real marker photos

Drop phone photos of printed markers here. The expected marker id is read from the filename:

    id07_dimlight.jpg      -> must detect id 7
    id00_angle30_2m.png    -> must detect id 0

Format: `id<NN>_<anything>.jpg|jpeg|png`. Several markers in one photo are fine; the expected id only has to be among the detections.
`tests/real-markers.test.ts` downscales each image to 640 px wide (like the AR path) and runs the detector.
