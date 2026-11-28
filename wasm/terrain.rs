// Workspace is instance-local. The TS host reads and writes only inside this allocation.
#[repr(align(16))]
struct Workspace([u8; 1024 * 1024]);
static mut WORKSPACE: Workspace = Workspace([0; 1024 * 1024]);

#[no_mangle]
pub extern "C" fn scratchBase() -> *mut u8 {
    unsafe { core::ptr::addr_of_mut!(WORKSPACE.0).cast() }
}

#[no_mangle]
pub extern "C" fn hash2i(x: i32, z: i32) -> f32 {
    let h = (x as u32).wrapping_mul(374761393) ^ (z as u32).wrapping_mul(668265263) ^ 0x5bd1e995;
    let h = (h ^ (h >> 13)).wrapping_mul(1274126177);
    (h ^ (h >> 16)) as f32 * (1.0 / 4294967296.0)
}

#[inline]
fn fade(t: f32) -> f32 {
    t * t * (3.0 - 2.0 * t)
}

#[no_mangle]
pub extern "C" fn smoothNoise(x: f32, z: f32) -> f32 {
    let (ix, iz) = (x.floor() as i32, z.floor() as i32);
    let (u, v) = (fade(x - x.floor()), fade(z - z.floor()));
    let a = hash2i(ix, iz);
    let b = hash2i(ix.wrapping_add(1), iz);
    let c = hash2i(ix, iz.wrapping_add(1));
    let d = hash2i(ix.wrapping_add(1), iz.wrapping_add(1));
    a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v
}

#[inline]
fn fbm<const OCTAVES: usize>(x: f32, z: f32, mut frequency: f32) -> f32 {
    let mut sum = 0.0;
    let mut amplitude = 0.5;
    for _ in 0..OCTAVES {
        sum += (2.0 * smoothNoise(x * frequency, z * frequency) - 1.0) * amplitude;
        frequency *= 2.02;
        amplitude *= 0.5;
    }
    sum
}

// Host supplies an aligned output region for dim * dim triples within WORKSPACE.
#[no_mangle]
pub unsafe extern "C" fn fillNoiseGrid(
    mut out: *mut [f32; 3],
    start_x: f32,
    start_z: f32,
    step: f32,
    dim: i32,
) {
    for row in 0..dim {
        let z = start_z + row as f32 * step;
        for column in 0..dim {
            let x = start_x + column as f32 * step;
            out.write([
                fbm::<4>(x, z, 0.008),
                fbm::<2>(x, z, 0.03),
                smoothNoise(x * 0.09, z * 0.09),
            ]);
            out = out.add(1);
        }
    }
}
