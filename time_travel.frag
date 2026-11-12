uniform float uEffect;
uniform float uColorMix;
uniform float uTravel;
uniform float uVelocity;
uniform float uSmear;
uniform float uBlocks;

layout(location = 0) out vec4 fragColor;


// ============================================================
// GORSEL AYARLAR
// ============================================================

// Agaclarin gorunurlugu.
const float TREE_STRENGTH = 0.28;

// Katmanlarin egimi / kivrimi.
const float CURVE_AMOUNT = 0.065;

// Isik oldukca kisik.
const float SOFT_LIGHT = 0.055;

// Efektten cikarken yatay bulaniklik.
// 1920 genislik referansinda piksel.
const float EXIT_BLUR_PIXELS = 110.0;

const int FLOW_SAMPLES = 32;
const int EXIT_SAMPLES = 32;
const int TREE_SAMPLES = 7;

const float TAU = 6.28318530718;


// ============================================================
// HELPERS
// ============================================================

float hash11(float n)
{
    return fract(sin(n * 127.1 + 311.7) * 43758.5453);
}

float luminance(vec3 c)
{
    return dot(c, vec3(0.2126, 0.7152, 0.0722));
}


// ============================================================
// ESKI / YENI SAHNE
// ============================================================

vec3 sourceColor(vec2 uv, float colorMix, bool wrapX)
{
    if (wrapX)
        uv.x = fract(uv.x);

    vec2 oldHalfPixel = uTD2DInfos[0].res.xy * 0.5;
    vec2 newHalfPixel = uTD2DInfos[1].res.xy * 0.5;

    vec2 oldUV = clamp(
        uv,
        oldHalfPixel,
        vec2(1.0) - oldHalfPixel
    );

    vec2 newUV = clamp(
        uv,
        newHalfPixel,
        vec2(1.0) - newHalfPixel
    );

    if (colorMix <= 0.0001)
        return texture(sTD2DInputs[0], oldUV).rgb;

    if (colorMix >= 0.9999)
        return texture(sTD2DInputs[1], newUV).rgb;

    vec3 oldColor = texture(sTD2DInputs[0], oldUV).rgb;
    vec3 newColor = texture(sTD2DInputs[1], newUV).rgb;

    return mix(oldColor, newColor, colorMix);
}


// ============================================================
// CIKISTA BULANIK SAHNEDEN NET SAHNEYE
// ============================================================

vec3 horizontalSceneBlur(
    vec2 uv,
    float colorMix,
    float amount
)
{
    if (amount <= 0.0001)
        return sourceColor(uv, colorMix, false);

    float width = EXIT_BLUR_PIXELS / 1920.0 * amount;

    vec3 sum = vec3(0.0);
    float weightSum = 0.0;

    for (int i = 0; i < EXIT_SAMPLES; i++)
    {
        float s = (float(i) + 0.5) / float(EXIT_SAMPLES);
        float x = s * 2.0 - 1.0;
        float weight = exp(-3.0 * x * x);

        vec2 sampleUV = uv + vec2(x * width * 0.5, 0.0);

        sum += sourceColor(sampleUV, colorMix, false) * weight;
        weightSum += weight;
    }

    return sum / max(weightSum, 0.0001);
}


// ============================================================
// UZUN YATAY RENK AKISI
// ============================================================

vec3 flowBlur(
    vec2 uv,
    float colorMix,
    float width,
    float direction
)
{
    vec3 sum = vec3(0.0);
    float weightSum = 0.0;

    for (int i = 0; i < FLOW_SAMPLES; i++)
    {
        float s = (float(i) + 0.5) / float(FLOW_SAMPLES);
        float x = s - 0.5;

        float weight = exp(-5.5 * x * x);

        vec2 sampleUV = uv;

        sampleUV.x += width * (
            x + 0.22 * direction
        );

        sum += sourceColor(sampleUV, colorMix, true) * weight;
        weightSum += weight;
    }

    return sum / max(weightSum, 0.0001);
}


// ============================================================
// AGAC ATLASI
//
// 3 sutun x 2 satir.
//
// ID:
// 0 Ghaf       1 Cottonwood  2 Banyan
// 3 Forest     4 Oak         5 Alternate
//
// Siyah-beyaz maskeyi RGB'den okuyoruz.
// Alpha varsa onunla da carpiyoruz.
// ============================================================

float atlasMask(vec2 localUV, float treeID)
{
    if (
        localUV.x <= 0.0 ||
        localUV.x >= 1.0 ||
        localUV.y <= 0.0 ||
        localUV.y >= 1.0
    )
    {
        return 0.0;
    }

    float id = clamp(floor(treeID), 0.0, 5.0);
    float column = mod(id, 3.0);
    float rowFromTop = floor(id / 3.0);

    vec2 cell = vec2(column, 1.0 - rowFromTop);

    // Hucre sinirindan komsu agaci okumamaya dikkat et.
    vec2 halfPixel = uTD2DInfos[2].res.xy * 0.5;

    vec2 uvMin = cell / vec2(3.0, 2.0) + halfPixel;
    vec2 uvMax = (cell + 1.0) / vec2(3.0, 2.0) - halfPixel;

    vec2 atlasUV = (cell + localUV) / vec2(3.0, 2.0);
    atlasUV = clamp(atlasUV, uvMin, uvMax);

    vec4 texel = texture(sTD2DInputs[2], atlasUV);

    float value = luminance(texel.rgb) * texel.a;

    // Dusuk seviyeli kir / ince artiklari temizler.
    float mask = smoothstep(0.30, 0.78, value);

    // Uretilen atlasin hucre kenarlarindaki tasmalari yumusatir.
    vec2 edge = min(localUV, vec2(1.0) - localUV);

    float isolation =
        smoothstep(0.0, 0.065, edge.x) *
        smoothstep(0.0, 0.035, edge.y);

    return mask * isolation;
}


// ============================================================
// YATAY HAREKET BULANIKLIGI OLAN SILUET
// ============================================================

float blurredTree(
    vec2 localUV,
    float treeID,
    float blurWidth,
    float direction
)
{
    float sum = 0.0;
    float weightSum = 0.0;

    for (int i = 0; i < TREE_SAMPLES; i++)
    {
        float s = (float(i) + 0.5) / float(TREE_SAMPLES);
        float x = s * 2.0 - 1.0;

        float weight = exp(-2.5 * x * x);

        vec2 sampleUV = localUV;

        sampleUV.x += blurWidth * (
            x + 0.30 * direction
        );

        sum += atlasMask(sampleUV, treeID) * weight;
        weightSum += weight;
    }

    return sum / max(weightSum, 0.0001);
}


// ============================================================
// BIR DERINLIK KATMANINDA AGACLAR
//
// Animasyon uTravel ile ilerler.
// Direction tersine donunce konum sicramadan geri akar.
// ============================================================

float treeLayer(
    vec2 uv,
    float depth,
    float direction,
    float curve,
    float aspect
)
{
    float layerSeed = depth * 19.0 + 7.0;

    float speed = mix(0.28, 0.72, depth);
    float spacing = mix(0.58, 0.88, depth);

    // Buyuk koordinatlarda hassasiyet kaybini azalt.
    // Periyot 256 hucre, hash de ayni periyotta.
    float travel = mod(
        uTravel * speed,
        spacing * 256.0
    );

    float worldX = uv.x - travel;

    float centerCell = floor(worldX / spacing);
    float maskSum = 0.0;

    for (int j = -1; j <= 1; j++)
    {
        float cell = centerCell + float(j);
        float stableCell = mod(cell, 256.0);

        float seed = stableCell + layerSeed;

        float r0 = hash11(seed);
        float r1 = hash11(seed + 13.4);
        float r2 = hash11(seed + 37.8);

        float treeID = floor(r0 * 6.0);

        float treeX = (
            cell + 0.28 + r1 * 0.44
        ) * spacing;

        float dx = worldX - treeX;

        // Ekranda ilerlerken yavasca buyuyup kuculme.
        // Sadece zaman akisi ile bagli, direction degisimi sicratmaz.
        float growth = 0.5 + 0.5 * sin(
            uTravel * 0.48 + r2 * TAU + depth
        );

        float treeHeight =
            mix(0.25, 0.56, depth) *
            mix(0.80, 1.12, r1) *
            mix(0.88, 1.12, growth);

        // Atlas hucresinin fiziksel en/boy oranini korur.
        vec2 atlasSize = uTD2DInfos[2].res.zw;

        float cellAspect =
            (atlasSize.x / 3.0) /
            (atlasSize.y / 2.0);

        float treeWidth =
            treeHeight * cellAspect / max(aspect, 0.001);

        float baseY =
            mix(0.39, 0.12, depth) +
            (r2 - 0.5) * 0.12 +
            curve * mix(0.40, 0.90, depth);

        // Atlasin alt boslugunu hesaba katarak kokten olcekle.
        vec2 localUV;

        localUV.x = dx / max(treeWidth, 0.001) + 0.5;
        localUV.y = (uv.y - baseY) /
                    max(treeHeight, 0.001) + 0.15;

        float mask = blurredTree(
            localUV,
            treeID,
            mix(0.075, 0.19, depth),
            direction
        );

        // Siluetlerin bir anda belirip yok olmamasini saglar.
        float passage = 1.0 - smoothstep(
            0.30,
            0.74,
            abs(uv.x - 0.5)
        );

        float presence = mix(0.48, 0.90, r0);

        maskSum += mask * passage * presence;
    }

    return clamp(maskSum, 0.0, 1.0);
}


// ============================================================
// HACIMLI YATAY AKIS
// ============================================================

vec3 timeFlow(
    vec2 uv,
    float colorMix,
    float level
)
{
    float aspect =
        uTDOutputInfo.res.z /
        max(uTDOutputInfo.res.w, 1.0);

    float deformation = clamp(uBlocks, 0.0, 1.0);
    float smear = clamp(uSmear, 0.0, 1.5);

    float direction =
        uVelocity / sqrt(uVelocity * uVelocity + 0.04);

    float chaos = smoothstep(0.12, 0.95, level);

    // Sinus argumanini sinirli tutar.
    float phase = mod(uTravel * 0.17, TAU);

    // Tum hareket yatay; bu egri yalnizca hacim hissi verir.
    float curve =
        CURVE_AMOUNT *
        deformation *
        chaos *
        (
            sin(uv.x * 3.8 + phase) +
            0.32 * sin(uv.x * 7.1 - phase * 2.0)
        );

    vec3 colorSum = vec3(0.0);
    float weightSum = 0.0;

    for (int i = 0; i < 3; i++)
    {
        float depth = float(i) * 0.5;

        // Uzak, orta, yakin katman.
        float speed = mix(0.30, 0.92, depth);

        vec2 layerUV = uv;

        layerUV.y -= curve * mix(0.45, 1.0, depth);

        layerUV.y +=
            0.013 *
            deformation *
            sin(
                uv.x * 5.0 +
                depth * 4.0 +
                phase
            );

        layerUV.x -= mod(uTravel * speed, 1.0);

        // Sinirli deformasyon: zamanla artan shear yok.
        layerUV.x +=
            deformation *
            chaos *
            0.025 *
            sin(
                uv.y * 12.0 +
                depth * 3.0 +
                phase
            );

        float width =
            mix(0.17, 0.40, depth) *
            smear *
            chaos;

        vec3 layerColor = flowBlur(
            layerUV,
            colorMix,
            width,
            direction
        );

        float band = 0.5 + 0.5 * sin(
            (uv.y - curve) * 10.5 +
            depth * 3.0 +
            phase * 0.35
        );

        float weight = mix(
            0.22,
            1.0,
            smoothstep(0.12, 0.88, band)
        );

        // Katmanlar arasinda hafif karanlik bosluk.
        layerColor *= mix(0.77, 1.0, band);

        colorSum += layerColor * weight;
        weightSum += weight;
    }

    vec3 color = colorSum / max(weightSum, 0.0001);

    // Kivrimli ince hacim izi: sabit beyaz parilti eklemiyoruz.
    float foldedY = uv.y - curve;

    float softRidge = pow(
        0.5 + 0.5 * sin(foldedY * 15.0 + phase * 0.25),
        8.0
    );

    color *= 1.0 + softRidge * SOFT_LIGHT * chaos;

    // Uzak ve yakin siluetler.
    float distantTrees = treeLayer(
        uv, 0.0, direction, curve, aspect
    );

    float middleTrees = treeLayer(
        uv, 0.5, direction, curve, aspect
    );

    float nearTrees = treeLayer(
        uv, 1.0, direction, curve, aspect
    );

    float treeMask = clamp(
        distantTrees * 0.40 +
        middleTrees * 0.70 +
        nearTrees,
        0.0,
        1.0
    );

    // Siluetler mevcut akis renginin daha koyu hali.
    // Yeni bir renk paleti dayatmiyor.
    vec3 silhouetteColor = color * 0.23;

    color = mix(
        color,
        silhouetteColor,
        treeMask * TREE_STRENGTH * chaos
    );

    return max(color, vec3(0.0));
}


// ============================================================
// MAIN
// ============================================================

void main()
{
    vec2 uv = vUV.st;

    float level = clamp(uEffect, 0.0, 1.0);
    float colorMix = clamp(uColorMix, 0.0, 1.0);

    if (level <= 0.001)
    {
        vec3 clean = sourceColor(uv, colorMix, false);

        fragColor = TDOutputSwizzle(
            vec4(clean, 1.0)
        );

        return;
    }

    float flowMix = smoothstep(0.28, 0.82, level);
    float sceneBlur = smoothstep(0.0, 0.38, level);

    vec3 baseScene = vec3(0.0);

    if (flowMix < 0.9999)
    {
        baseScene = horizontalSceneBlur(
            uv,
            colorMix,
            sceneBlur
        );
    }

    if (flowMix <= 0.0001)
    {
        fragColor = TDOutputSwizzle(
            vec4(baseScene, 1.0)
        );

        return;
    }

    vec3 flowing = timeFlow(
        uv,
        colorMix,
        level
    );

    vec3 finalColor = mix(
        baseScene,
        flowing,
        flowMix
    );

    fragColor = TDOutputSwizzle(
        vec4(finalColor, 1.0)
    );
}